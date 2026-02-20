const { spawn } = require('child_process');
const path = require('path');
const fs = require('fs');
const TemplateRenderer = require('./templateRenderer');

// FFmpeg path - use system ffmpeg on Linux/Railway, Windows path locally
const FFMPEG_PATH = process.platform === 'win32' 
  ? path.normalize('C:/Users/micha/AppData/Local/Microsoft/WinGet/Packages/Gyan.FFmpeg_Microsoft.Winget.Source_8wekyb3d8bbwe/ffmpeg-8.0.1-full_build/bin/ffmpeg.exe')
  : 'ffmpeg';

class VideoProcessor {
  constructor(uploadsDir, outputDir) {
    this.uploadsDir = uploadsDir;
    this.outputDir = outputDir;
    this.tempDir = path.join(outputDir, 'temp');
    this.ffmpegPath = FFMPEG_PATH;
    this.renderer = new TemplateRenderer();
    
    // Ensure directories exist
    if (!fs.existsSync(this.outputDir)) fs.mkdirSync(this.outputDir, { recursive: true });
    if (!fs.existsSync(this.tempDir)) fs.mkdirSync(this.tempDir, { recursive: true });
  }

  // Run FFmpeg command and return promise
  runFFmpeg(args) {
    return new Promise((resolve, reject) => {
      console.log('FFmpeg:', args.slice(0, 6).join(' ') + '...');
      
      const proc = spawn(this.ffmpegPath, args, { 
        stdio: ['pipe', 'pipe', 'pipe'],
        windowsHide: true
      });
      
      let stderr = '';
      proc.stderr.on('data', (data) => {
        stderr += data.toString();
      });
      
      proc.on('close', (code) => {
        if (code !== 0) {
          reject(new Error(`FFmpeg error (code ${code}): ${stderr.slice(-500)}`));
        } else {
          resolve();
        }
      });
      
      proc.on('error', (err) => {
        reject(new Error(`FFmpeg spawn error: ${err.message}`));
      });
    });
  }

  // Convert PNG to video segment
  async imageToVideo(imagePath, outputPath, duration = 3) {
    const args = [
      '-loop', '1',
      '-i', imagePath,
      '-c:v', 'libx264',
      '-t', duration.toString(),
      '-pix_fmt', 'yuv420p',
      '-vf', 'scale=1080:1920',
      '-r', '30',
      '-y',
      outputPath
    ];
    await this.runFFmpeg(args);
  }

  // Normalize a clip to standard format (1080x1920 vertical, 30fps)
  async normalizeClip(inputPath, outputPath) {
    const args = [
      '-i', inputPath,
      '-vf', 'scale=1080:1920:force_original_aspect_ratio=decrease,pad=1080:1920:(ow-iw)/2:(oh-ih)/2,setsar=1,fps=30',
      '-c:v', 'libx264',
      '-preset', 'fast',
      '-crf', '23',
      '-c:a', 'aac',
      '-b:a', '128k',
      '-ar', '44100',
      '-ac', '2',
      '-y',
      outputPath
    ];
    await this.runFFmpeg(args);
  }

  // Create slow-mo version of a clip (0.5x speed)
  async createSlowMo(inputPath, outputPath) {
    const args = [
      '-i', inputPath,
      '-vf', 'setpts=2.0*PTS',
      '-af', 'atempo=0.5',
      '-c:v', 'libx264',
      '-preset', 'fast',
      '-crf', '23',
      '-c:a', 'aac',
      '-y',
      outputPath
    ];
    await this.runFFmpeg(args);
  }
  
  // Add commentary sound effect to a video clip (for goals)
  async addCommentarySound(videoPath, outputPath, soundsDir) {
    // Get available sound files
    const soundFiles = fs.readdirSync(soundsDir).filter(f => f.endsWith('.mp3') || f.endsWith('.wav'));
    
    if (soundFiles.length === 0) {
      console.log('No commentary sounds found, skipping...');
      fs.copyFileSync(videoPath, outputPath);
      return;
    }
    
    // Pick a random sound
    const randomSound = soundFiles[Math.floor(Math.random() * soundFiles.length)];
    const soundPath = path.join(soundsDir, randomSound);
    console.log(`Adding commentary sound: ${randomSound}`);
    
    // Check if video has audio
    const hasAudio = await this.videoHasAudio(videoPath);
    
    let args;
    if (hasAudio) {
      // Mix video audio with commentary sound (commentary louder)
      args = [
        '-i', videoPath,
        '-i', soundPath,
        '-filter_complex', '[1:a]adelay=500|500,volume=1.5[sfx];[0:a]volume=0.6[orig];[orig][sfx]amix=inputs=2:duration=first[aout]',
        '-map', '0:v',
        '-map', '[aout]',
        '-c:v', 'copy',
        '-c:a', 'aac',
        '-b:a', '192k',
        '-y',
        outputPath
      ];
    } else {
      // No video audio - just add commentary sound
      args = [
        '-i', videoPath,
        '-i', soundPath,
        '-filter_complex', '[1:a]adelay=500|500,volume=1.2[aout]',
        '-map', '0:v',
        '-map', '[aout]',
        '-c:v', 'copy',
        '-c:a', 'aac',
        '-b:a', '192k',
        '-shortest',
        '-y',
        outputPath
      ];
    }
    
    await this.runFFmpeg(args);
  }

  // Convert landscape to vertical (9:16) with blur background
  async convertToVertical(inputPath, outputPath) {
    const args = [
      '-i', inputPath,
      '-vf', 'split[original][blur];[blur]scale=1080:1920:force_original_aspect_ratio=increase,crop=1080:1920,boxblur=20[bg];[original]scale=1080:-1[fg];[bg][fg]overlay=(W-w)/2:(H-h)/2',
      '-c:v', 'libx264',
      '-preset', 'fast',
      '-crf', '23',
      '-c:a', 'aac',
      '-b:a', '128k',
      '-y',
      outputPath
    ];
    await this.runFFmpeg(args);
  }

  // Overlay PNG on video (full frame overlay for GOAL/SKILLS/etc text)
  async overlayImage(videoPath, overlayPath, outputPath) {
    const args = [
      '-i', videoPath,
      '-i', overlayPath,
      '-filter_complex', '[0:v][1:v]overlay=0:0:enable=\'between(t,0,3)\'',
      '-c:v', 'libx264',
      '-preset', 'fast',
      '-crf', '23',
      '-c:a', 'copy',
      '-y',
      outputPath
    ];
    await this.runFFmpeg(args);
  }

  // Concatenate multiple videos
  async concatenateVideos(inputPaths, outputPath) {
    const concatFile = path.join(this.tempDir, `concat-${Date.now()}.txt`);
    
    // Verify all input files exist
    for (const p of inputPaths) {
      if (!fs.existsSync(p)) {
        console.error(`Missing segment: ${p}`);
      }
    }
    
    // Use forward slashes and escape single quotes for FFmpeg concat
    const content = inputPaths
      .filter(p => fs.existsSync(p))
      .map(p => `file '${p.replace(/\\/g, '/').replace(/'/g, "'\\''")}'`)
      .join('\n');
    
    fs.writeFileSync(concatFile, content, 'utf8');
    console.log(`Concat file written: ${concatFile}`);
    console.log(`Segments: ${inputPaths.length}`);

    const args = [
      '-f', 'concat',
      '-safe', '0',
      '-i', concatFile,
      '-c:v', 'libx264',
      '-preset', 'fast',
      '-crf', '23',
      '-c:a', 'aac',
      '-b:a', '128k',
      '-movflags', '+faststart',
      '-y',
      outputPath
    ];

    try {
      await this.runFFmpeg(args);
    } finally {
      // Clean up concat file
      if (fs.existsSync(concatFile)) {
        fs.unlinkSync(concatFile);
      }
    }
  }

  // Add background music to video
  async addMusic(videoPath, musicPath, outputPath) {
    if (!fs.existsSync(musicPath)) {
      console.log('No music file found, skipping...');
      fs.copyFileSync(videoPath, outputPath);
      return;
    }

    // First check if video has audio stream
    const hasAudio = await this.videoHasAudio(videoPath);
    
    let args;
    if (hasAudio) {
      // Mix video audio with music
      args = [
        '-i', videoPath,
        '-i', musicPath,
        '-filter_complex', '[1:a]volume=0.3[music];[0:a][music]amix=inputs=2:duration=first[aout]',
        '-map', '0:v',
        '-map', '[aout]',
        '-c:v', 'copy',
        '-c:a', 'aac',
        '-b:a', '192k',
        '-y',
        outputPath
      ];
    } else {
      // No video audio - just use music at lower volume
      console.log('Video has no audio, using music only...');
      args = [
        '-i', videoPath,
        '-i', musicPath,
        '-filter_complex', '[1:a]volume=0.4,atrim=0:duration=999[aout]',
        '-map', '0:v',
        '-map', '[aout]',
        '-c:v', 'copy',
        '-c:a', 'aac',
        '-b:a', '192k',
        '-shortest',
        '-y',
        outputPath
      ];
    }

    await this.runFFmpeg(args);
  }
  
  // Check if video file has audio stream
  async videoHasAudio(videoPath) {
    return new Promise((resolve) => {
      const proc = spawn(this.ffmpegPath, ['-i', videoPath], { 
        stdio: ['pipe', 'pipe', 'pipe'],
        windowsHide: true
      });
      
      let stderr = '';
      proc.stderr.on('data', (data) => {
        stderr += data.toString();
      });
      
      proc.on('close', () => {
        // Check if there's an audio stream in the output
        resolve(stderr.includes('Audio:'));
      });
    });
  }

  // Main function to create the full highlight reel
  async createReel(matchId, matchData) {
    console.log(`\n🎬 Creating Sky Sports style reel for match ${matchId}...`);
    
    const {
      teamName,
      opponent,
      matchDate,
      competition,
      clips = [],
      score,
      playerOfMatch,
      teamOfDay = [],
      potmPhotoFilename,
      teamLogo,
      colors = { primary: '#0099cc', secondary: '#00ccff' },
      commentarySounds = false
    } = matchData;
    
    // Sounds directory for commentary
    const soundsDir = path.join(__dirname, '../public/sounds');
    const hasSounds = commentarySounds && fs.existsSync(soundsDir) && fs.readdirSync(soundsDir).filter(f => f.endsWith('.mp3') || f.endsWith('.wav')).length > 0;
    if (commentarySounds) {
      console.log(`🎙️ Commentary sounds: ${hasSounds ? 'ENABLED' : 'enabled but no sounds found'}`);
    }

    const matchDir = path.join(this.uploadsDir, matchId);
    const outputPath = path.join(this.outputDir, `${matchId}-highlight-reel.mp4`);
    const tempFiles = [];
    
    const cleanup = () => {
      tempFiles.forEach(f => {
        try { fs.unlinkSync(f); } catch (e) {}
      });
      this.renderer.close();
    };

    try {
      await this.renderer.init();
      const segments = [];
      let segmentIndex = 0;

      // 1. INTRO CARD
      console.log('Creating intro card...');
      const introPng = path.join(this.tempDir, `${matchId}-intro.png`);
      const introVid = path.join(this.tempDir, `${matchId}-intro.mp4`);
      tempFiles.push(introPng, introVid);
      
      const logoPath = teamLogo ? path.join(this.uploadsDir, 'logos', teamLogo) : null;
      const opponentLogoPath = matchData.opponentLogo ? path.join(this.uploadsDir, 'logos', matchData.opponentLogo) : null;
      await this.renderer.renderIntro(matchData, introPng, logoPath, opponentLogoPath);
      await this.imageToVideo(introPng, introVid, 4);
      segments.push(introVid);

      // 1b. TEAM SLIDE (if team photo uploaded)
      if (matchData.teamPhotoFilename) {
        console.log('Creating team slide...');
        const teamSlidePng = path.join(this.tempDir, `${matchId}-team-slide.png`);
        const teamSlideVid = path.join(this.tempDir, `${matchId}-team-slide.mp4`);
        tempFiles.push(teamSlidePng, teamSlideVid);
        
        const teamPhotoPath = path.join(matchDir, matchData.teamPhotoFilename);
        await this.renderer.renderTeamSlide(matchData, teamSlidePng, teamPhotoPath, logoPath);
        await this.imageToVideo(teamSlidePng, teamSlideVid, 5);
        segments.push(teamSlideVid);
      }

      // 2. GOALS
      const goals = clips.filter(c => c.type === 'goal');
      if (goals.length > 0) {
        console.log(`Processing ${goals.length} goals...`);

        for (const goal of goals) {
          const clipPath = path.join(matchDir, goal.filename);
          if (!fs.existsSync(clipPath)) continue;

          // Normalize clip
          const normPath = path.join(this.tempDir, `${matchId}-goal-${segmentIndex}-norm.mp4`);
          tempFiles.push(normPath);
          await this.normalizeClip(clipPath, normPath);

          // Create goal overlay
          const overlayPng = path.join(this.tempDir, `${matchId}-goal-${segmentIndex}-overlay.png`);
          const finalPath = path.join(this.tempDir, `${matchId}-goal-${segmentIndex}-final.mp4`);
          tempFiles.push(overlayPng, finalPath);
          
          await this.renderer.renderGoalOverlay(goal.scorer || 'GOAL!', overlayPng, colors);
          await this.overlayImage(normPath, overlayPng, finalPath);
          
          // Add commentary sound if enabled
          let goalClipToUse = finalPath;
          if (hasSounds) {
            const withSoundPath = path.join(this.tempDir, `${matchId}-goal-${segmentIndex}-sound.mp4`);
            tempFiles.push(withSoundPath);
            await this.addCommentarySound(finalPath, withSoundPath, soundsDir);
            goalClipToUse = withSoundPath;
          }
          
          segments.push(goalClipToUse);
          
          // Add slow-mo replay
          console.log('Creating slow-mo replay...');
          const slowMoPath = path.join(this.tempDir, `${matchId}-goal-${segmentIndex}-slowmo.mp4`);
          tempFiles.push(slowMoPath);
          await this.createSlowMo(goalClipToUse, slowMoPath);
          segments.push(slowMoPath);
          
          segmentIndex++;
        }
      }

      // 3. SAVES
      const saves = clips.filter(c => c.type === 'save');
      if (saves.length > 0) {
        console.log(`Processing ${saves.length} saves...`);

        for (const save of saves) {
          const clipPath = path.join(matchDir, save.filename);
          if (!fs.existsSync(clipPath)) continue;

          const normPath = path.join(this.tempDir, `${matchId}-save-${segmentIndex}-norm.mp4`);
          tempFiles.push(normPath);
          await this.normalizeClip(clipPath, normPath);
          segments.push(normPath);
          segmentIndex++;
        }
      }

      // 3. OPPOSITION GOALS
      const oppGoals = clips.filter(c => c.type === 'opp-goal');
      if (oppGoals.length > 0) {
        console.log(`Processing ${oppGoals.length} opposition goals...`);

        for (const goal of oppGoals) {
          const clipPath = path.join(matchDir, goal.filename);
          if (!fs.existsSync(clipPath)) continue;

          // Normalize clip
          const normPath = path.join(this.tempDir, `${matchId}-opp-goal-${segmentIndex}-norm.mp4`);
          tempFiles.push(normPath);
          await this.normalizeClip(clipPath, normPath);

          // Create opp goal overlay
          const overlayPng = path.join(this.tempDir, `${matchId}-opp-goal-${segmentIndex}-overlay.png`);
          const finalPath = path.join(this.tempDir, `${matchId}-opp-goal-${segmentIndex}-final.mp4`);
          tempFiles.push(overlayPng, finalPath);
          
          await this.renderer.renderOppGoalOverlay(opponent, overlayPng);
          await this.overlayImage(normPath, overlayPng, finalPath);
          
          segments.push(finalPath);
          segmentIndex++;
        }
      }

      // 4. CHANCES (BIG CHANCE overlay)
      const chances = clips.filter(c => c.type === 'chance');
      if (chances.length > 0) {
        console.log(`Processing ${chances.length} chances...`);

        for (const chance of chances) {
          const clipPath = path.join(matchDir, chance.filename);
          if (!fs.existsSync(clipPath)) continue;

          const normPath = path.join(this.tempDir, `${matchId}-chance-${segmentIndex}-norm.mp4`);
          tempFiles.push(normPath);
          await this.normalizeClip(clipPath, normPath);

          // Add BIG CHANCE overlay
          const overlayPng = path.join(this.tempDir, `${matchId}-chance-${segmentIndex}-overlay.png`);
          const finalPath = path.join(this.tempDir, `${matchId}-chance-${segmentIndex}-final.mp4`);
          tempFiles.push(overlayPng, finalPath);
          
          await this.renderer.renderChanceOverlay(chance.scorer || 'SO CLOSE!', overlayPng, colors);
          await this.overlayImage(normPath, overlayPng, finalPath);
          
          segments.push(finalPath);
          segmentIndex++;
        }
      }

      // 5. SKILLS
      const skills = clips.filter(c => c.type === 'skills');
      if (skills.length > 0) {
        console.log(`Processing ${skills.length} skills...`);

        for (const skill of skills) {
          const clipPath = path.join(matchDir, skill.filename);
          if (!fs.existsSync(clipPath)) continue;

          const normPath = path.join(this.tempDir, `${matchId}-skill-${segmentIndex}-norm.mp4`);
          tempFiles.push(normPath);
          await this.normalizeClip(clipPath, normPath);

          // Add skills badge overlay
          const overlayPng = path.join(this.tempDir, `${matchId}-skill-${segmentIndex}-overlay.png`);
          const finalPath = path.join(this.tempDir, `${matchId}-skill-${segmentIndex}-final.mp4`);
          tempFiles.push(overlayPng, finalPath);
          
          await this.renderer.renderSkillsOverlay(overlayPng);
          await this.overlayImage(normPath, overlayPng, finalPath);
          
          segments.push(finalPath);
          segmentIndex++;
        }
      }

      // 6. CELEBRATIONS
      const celebrations = clips.filter(c => c.type === 'celebration');
      if (celebrations.length > 0) {
        console.log(`Processing ${celebrations.length} celebrations...`);

        for (const celeb of celebrations) {
          const clipPath = path.join(matchDir, celeb.filename);
          if (!fs.existsSync(clipPath)) continue;

          const normPath = path.join(this.tempDir, `${matchId}-celeb-${segmentIndex}-norm.mp4`);
          tempFiles.push(normPath);
          await this.normalizeClip(clipPath, normPath);

          // Add celebration overlay
          const overlayPng = path.join(this.tempDir, `${matchId}-celeb-${segmentIndex}-overlay.png`);
          const finalPath = path.join(this.tempDir, `${matchId}-celeb-${segmentIndex}-final.mp4`);
          tempFiles.push(overlayPng, finalPath);
          
          await this.renderer.renderCelebrationOverlay(overlayPng);
          await this.overlayImage(normPath, overlayPng, finalPath);
          
          segments.push(finalPath);
          segmentIndex++;
        }
      }

      // 5. FINAL SCORE CARD
      if (score) {
        console.log('Creating score card...');
        const scorePng = path.join(this.tempDir, `${matchId}-score.png`);
        const scoreVid = path.join(this.tempDir, `${matchId}-score.mp4`);
        tempFiles.push(scorePng, scoreVid);
        
        await this.renderer.renderScore(matchData, scorePng);
        await this.imageToVideo(scorePng, scoreVid, 4);
        segments.push(scoreVid);
      }

      // 6. PLAYER OF THE MATCH
      if (playerOfMatch) {
        console.log('Creating POTM card...');
        const potmPng = path.join(this.tempDir, `${matchId}-potm.png`);
        const potmVid = path.join(this.tempDir, `${matchId}-potm.mp4`);
        tempFiles.push(potmPng, potmVid);
        
        const photoPath = potmPhotoFilename ? path.join(matchDir, potmPhotoFilename) : null;
        await this.renderer.renderPOTM(matchData, potmPng, photoPath);
        await this.imageToVideo(potmPng, potmVid, 4);
        segments.push(potmVid);
      }

      // 7. TEAM OF THE DAY
      if (teamOfDay && teamOfDay.length > 0) {
        console.log('Creating Team card...');
        const todPng = path.join(this.tempDir, `${matchId}-tod.png`);
        const todVid = path.join(this.tempDir, `${matchId}-tod.mp4`);
        tempFiles.push(todPng, todVid);
        
        await this.renderer.renderTeamOfDay(teamOfDay, todPng);
        await this.imageToVideo(todPng, todVid, 5);
        segments.push(todVid);
      }

      // 8. OUTRO
      console.log('Creating outro...');
      const outroPng = path.join(this.tempDir, `${matchId}-outro.png`);
      const outroVid = path.join(this.tempDir, `${matchId}-outro.mp4`);
      tempFiles.push(outroPng, outroVid);
      
      await this.renderer.renderOutro(outroPng);
      await this.imageToVideo(outroPng, outroVid, 3);
      segments.push(outroVid);

      // CONCATENATE ALL SEGMENTS
      console.log(`\nConcatenating ${segments.length} segments...`);
      const noMusicPath = path.join(this.tempDir, `${matchId}-no-music.mp4`);
      tempFiles.push(noMusicPath);
      await this.concatenateVideos(segments, noMusicPath);

      // ADD BACKGROUND MUSIC
      let musicPath = path.join(matchDir, 'background-music.mp3');
      
      // Download from URL if musicUrl is set
      if (matchData.musicUrl && !fs.existsSync(musicPath)) {
        console.log('Downloading music from URL...');
        try {
          const https = require('https');
          const http = require('http');
          const downloadUrl = matchData.musicUrl;
          const protocol = downloadUrl.startsWith('https') ? https : http;
          
          await new Promise((resolve, reject) => {
            const file = fs.createWriteStream(musicPath);
            protocol.get(downloadUrl, (response) => {
              // Follow redirects
              if (response.statusCode === 301 || response.statusCode === 302) {
                protocol.get(response.headers.location, (res) => {
                  res.pipe(file);
                  file.on('finish', () => { file.close(); resolve(); });
                }).on('error', reject);
              } else {
                response.pipe(file);
                file.on('finish', () => { file.close(); resolve(); });
              }
            }).on('error', (err) => {
              fs.unlink(musicPath, () => {});
              reject(err);
            });
          });
          console.log('Music downloaded successfully');
        } catch (err) {
          console.log('Failed to download music:', err.message);
        }
      }
      
      // Fallback to default music if exists (check both local and app directory)
      if (!fs.existsSync(musicPath)) {
        musicPath = path.join(__dirname, '../assets/music/background.mp3');
      }
      if (!fs.existsSync(musicPath)) {
        musicPath = '/app/assets/music/background.mp3';
      }
      
      if (fs.existsSync(musicPath)) {
        console.log('Adding background music...');
        await this.addMusic(noMusicPath, musicPath, outputPath);
      } else {
        console.log('No music file found, copying without music...');
        fs.copyFileSync(noMusicPath, outputPath);
      }

      console.log(`\n✅ Reel complete: ${outputPath}`);
      
      cleanup();

      return {
        success: true,
        outputPath,
        filename: `${matchId}-highlight-reel.mp4`,
        segments: segments.length
      };

    } catch (err) {
      cleanup();
      throw err;
    }
  }

  // Create vertical (9:16) version of the reel for Instagram/TikTok
  async createVerticalReel(matchId, matchData) {
    console.log(`\n📱 Creating vertical reel for match ${matchId}...`);
    
    const inputPath = path.join(this.outputDir, `${matchId}-highlight-reel.mp4`);
    const outputPath = path.join(this.outputDir, `${matchId}-vertical-reel.mp4`);
    
    if (!fs.existsSync(inputPath)) {
      throw new Error('Landscape reel not found. Generate it first.');
    }
    
    await this.convertToVertical(inputPath, outputPath);
    
    console.log(`✅ Vertical reel complete: ${outputPath}`);
    
    return {
      success: true,
      outputPath,
      filename: `${matchId}-vertical-reel.mp4`
    };
  }
}

module.exports = VideoProcessor;
