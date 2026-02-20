/**
 * Client-side video renderer using FFmpeg.wasm
 * Processes videos in the browser - no server costs!
 */

class VideoRenderer {
  constructor() {
    this.ffmpeg = null;
    this.loaded = false;
    this.onProgress = null;
  }

  async load(onProgress) {
    if (this.loaded) return;
    
    this.onProgress = onProgress;
    this.updateProgress('Loading video processor...', 0);

    // Load FFmpeg from CDN
    const { createFFmpeg, fetchFile } = FFmpeg;
    
    this.ffmpeg = createFFmpeg({
      log: true,
      progress: ({ ratio }) => {
        if (this.currentStep) {
          this.updateProgress(this.currentStep, Math.round(ratio * 100));
        }
      }
    });

    await this.ffmpeg.load();
    this.loaded = true;
    this.fetchFile = fetchFile;
    
    this.updateProgress('Ready!', 100);
  }

  updateProgress(step, percent) {
    this.currentStep = step;
    if (this.onProgress) {
      this.onProgress(step, percent);
    }
  }

  // Create a title card image using Canvas
  createTitleCard(text, subtext, colors, width = 720, height = 1280) {
    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext('2d');

    // Background gradient
    const gradient = ctx.createLinearGradient(0, 0, width, height);
    gradient.addColorStop(0, colors.primary || '#0099cc');
    gradient.addColorStop(1, colors.secondary || '#00ccff');
    ctx.fillStyle = gradient;
    ctx.fillRect(0, 0, width, height);

    // Add diagonal stripes
    ctx.strokeStyle = 'rgba(255,255,255,0.1)';
    ctx.lineWidth = 40;
    for (let i = -height; i < width + height; i += 80) {
      ctx.beginPath();
      ctx.moveTo(i, 0);
      ctx.lineTo(i + height, height);
      ctx.stroke();
    }

    // Main text
    ctx.fillStyle = '#fff';
    ctx.font = 'bold 72px Arial, sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    
    // Text shadow
    ctx.shadowColor = 'rgba(0,0,0,0.5)';
    ctx.shadowBlur = 10;
    ctx.shadowOffsetX = 3;
    ctx.shadowOffsetY = 3;
    
    ctx.fillText(text, width / 2, height / 2 - 50);

    // Subtext
    ctx.font = 'bold 36px Arial, sans-serif';
    ctx.fillStyle = 'rgba(255,255,255,0.9)';
    ctx.fillText(subtext, width / 2, height / 2 + 50);

    return canvas.toDataURL('image/png');
  }

  // Create goal overlay image
  createGoalOverlay(scorer, colors, width = 720, height = 1280) {
    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext('2d');

    // Transparent background
    ctx.clearRect(0, 0, width, height);

    // Bottom banner
    const bannerHeight = 200;
    const y = height - bannerHeight - 100;
    
    // Banner background
    ctx.fillStyle = 'rgba(0,0,0,0.7)';
    ctx.fillRect(0, y, width, bannerHeight);
    
    // Accent line
    ctx.fillStyle = colors.primary || '#00ff88';
    ctx.fillRect(0, y, 8, bannerHeight);

    // GOAL! text
    ctx.fillStyle = colors.primary || '#00ff88';
    ctx.font = 'bold 64px Arial, sans-serif';
    ctx.textAlign = 'left';
    ctx.fillText('GOAL!', 30, y + 70);

    // Scorer name
    ctx.fillStyle = '#fff';
    ctx.font = 'bold 42px Arial, sans-serif';
    ctx.fillText(scorer || '', 30, y + 140);

    return canvas.toDataURL('image/png');
  }

  // Create POTM card
  createPOTMCard(playerName, teamName, colors, width = 720, height = 1280) {
    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext('2d');

    // Background
    const gradient = ctx.createLinearGradient(0, 0, width, height);
    gradient.addColorStop(0, colors.primary || '#0099cc');
    gradient.addColorStop(1, colors.secondary || '#00ccff');
    ctx.fillStyle = gradient;
    ctx.fillRect(0, 0, width, height);

    // Stripes
    ctx.strokeStyle = 'rgba(255,255,255,0.1)';
    ctx.lineWidth = 40;
    for (let i = -height; i < width + height; i += 80) {
      ctx.beginPath();
      ctx.moveTo(i, 0);
      ctx.lineTo(i + height, height);
      ctx.stroke();
    }

    // Stars
    ctx.fillStyle = '#ffd700';
    ctx.font = '48px Arial';
    ctx.textAlign = 'center';
    ctx.fillText('⭐ ⭐ ⭐', width / 2, 150);

    // Title
    ctx.fillStyle = '#fff';
    ctx.font = 'bold 56px Arial, sans-serif';
    ctx.shadowColor = 'rgba(0,0,0,0.5)';
    ctx.shadowBlur = 10;
    ctx.fillText('PLAYER OF', width / 2, height / 2 - 80);
    ctx.fillText('THE MATCH', width / 2, height / 2);

    // Player name
    ctx.fillStyle = '#ffd700';
    ctx.font = 'bold 64px Arial, sans-serif';
    ctx.fillText(playerName, width / 2, height / 2 + 120);

    // Team name
    ctx.fillStyle = 'rgba(255,255,255,0.8)';
    ctx.font = '32px Arial, sans-serif';
    ctx.fillText(teamName, width / 2, height - 150);

    return canvas.toDataURL('image/png');
  }

  // Create score card
  createScoreCard(teamName, opponent, homeScore, awayScore, colors, width = 720, height = 1280) {
    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext('2d');

    // Background
    const gradient = ctx.createLinearGradient(0, 0, width, height);
    gradient.addColorStop(0, colors.primary || '#0099cc');
    gradient.addColorStop(1, colors.secondary || '#00ccff');
    ctx.fillStyle = gradient;
    ctx.fillRect(0, 0, width, height);

    // Center content
    ctx.fillStyle = '#fff';
    ctx.textAlign = 'center';
    ctx.shadowColor = 'rgba(0,0,0,0.5)';
    ctx.shadowBlur = 10;

    // FULL TIME
    ctx.font = 'bold 36px Arial, sans-serif';
    ctx.fillText('FULL TIME', width / 2, height / 2 - 200);

    // Team names
    ctx.font = 'bold 42px Arial, sans-serif';
    ctx.fillText(teamName, width / 2, height / 2 - 80);
    
    // Score
    ctx.font = 'bold 120px Arial, sans-serif';
    ctx.fillText(`${homeScore} - ${awayScore}`, width / 2, height / 2 + 60);
    
    // Opponent
    ctx.font = 'bold 42px Arial, sans-serif';
    ctx.fillText(opponent, width / 2, height / 2 + 160);

    return canvas.toDataURL('image/png');
  }

  // Create outro card
  createOutroCard(width = 720, height = 1280) {
    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext('2d');

    // Dark background
    ctx.fillStyle = '#1a1a2e';
    ctx.fillRect(0, 0, width, height);

    ctx.fillStyle = '#fff';
    ctx.textAlign = 'center';
    ctx.font = 'bold 48px Arial, sans-serif';
    ctx.fillText('⚽ MatchReel', width / 2, height / 2 - 30);
    
    ctx.font = '28px Arial, sans-serif';
    ctx.fillStyle = 'rgba(255,255,255,0.6)';
    ctx.fillText('matchreel.fun', width / 2, height / 2 + 40);

    return canvas.toDataURL('image/png');
  }

  // Convert data URL to Uint8Array for FFmpeg
  async dataUrlToUint8Array(dataUrl) {
    const response = await fetch(dataUrl);
    const blob = await response.blob();
    return new Uint8Array(await blob.arrayBuffer());
  }

  // Main render function
  async renderReel(matchData, clips, onProgress) {
    this.onProgress = onProgress;
    
    if (!this.loaded) {
      await this.load(onProgress);
    }

    const { teamName, opponent, matchDate, score, playerOfMatch, colors } = matchData;
    const segments = [];
    let segmentIndex = 0;

    try {
      // 1. Create intro card
      this.updateProgress('Creating intro...', 5);
      const introImg = this.createTitleCard(
        `${teamName}`,
        `vs ${opponent}`,
        colors
      );
      const introData = await this.dataUrlToUint8Array(introImg);
      this.ffmpeg.FS('writeFile', 'intro.png', introData);
      
      await this.ffmpeg.run(
        '-loop', '1', '-i', 'intro.png',
        '-c:v', 'libx264', '-t', '3', '-pix_fmt', 'yuv420p',
        '-vf', 'scale=720:1280',
        '-r', '30', '-y', 'intro.mp4'
      );
      segments.push('intro.mp4');

      // 2. Process each clip
      const clipFiles = [];
      for (let i = 0; i < clips.length; i++) {
        const clip = clips[i];
        const progress = 10 + Math.round((i / clips.length) * 60);
        this.updateProgress(`Processing clip ${i + 1}/${clips.length}...`, progress);

        // Fetch clip from server
        const clipUrl = clip.url || `/uploads/${matchData.id}/${clip.filename}`;
        const clipData = await this.fetchFile(clipUrl);
        const inputName = `clip${i}.mp4`;
        const outputName = `clip${i}_norm.mp4`;
        
        this.ffmpeg.FS('writeFile', inputName, clipData);

        // Normalize clip (scale to 720x1280, 30fps)
        await this.ffmpeg.run(
          '-i', inputName,
          '-vf', 'scale=720:1280:force_original_aspect_ratio=decrease,pad=720:1280:(ow-iw)/2:(oh-ih)/2,setsar=1',
          '-c:v', 'libx264', '-preset', 'ultrafast', '-crf', '28',
          '-r', '30', '-pix_fmt', 'yuv420p',
          '-c:a', 'aac', '-b:a', '128k',
          '-y', outputName
        );

        // Add overlay for goals
        if (clip.type === 'goal' && clip.scorer) {
          const overlayImg = this.createGoalOverlay(clip.scorer, colors);
          const overlayData = await this.dataUrlToUint8Array(overlayImg);
          this.ffmpeg.FS('writeFile', `overlay${i}.png`, overlayData);
          
          const finalName = `clip${i}_final.mp4`;
          await this.ffmpeg.run(
            '-i', outputName,
            '-i', `overlay${i}.png`,
            '-filter_complex', '[0:v][1:v]overlay=0:0:enable=between(t\\,0\\,3)',
            '-c:v', 'libx264', '-preset', 'ultrafast',
            '-c:a', 'copy', '-y', finalName
          );
          segments.push(finalName);
        } else {
          segments.push(outputName);
        }

        // Clean up input file to save memory
        this.ffmpeg.FS('unlink', inputName);
      }

      // 3. Score card (if score provided)
      if (score && score.home !== undefined) {
        this.updateProgress('Creating score card...', 75);
        const scoreImg = this.createScoreCard(
          teamName, opponent,
          score.home, score.away,
          colors
        );
        const scoreData = await this.dataUrlToUint8Array(scoreImg);
        this.ffmpeg.FS('writeFile', 'score.png', scoreData);
        
        await this.ffmpeg.run(
          '-loop', '1', '-i', 'score.png',
          '-c:v', 'libx264', '-t', '4', '-pix_fmt', 'yuv420p',
          '-vf', 'scale=720:1280',
          '-r', '30', '-y', 'score.mp4'
        );
        segments.push('score.mp4');
      }

      // 4. POTM card (if set)
      if (playerOfMatch) {
        this.updateProgress('Creating POTM card...', 80);
        const potmImg = this.createPOTMCard(playerOfMatch, teamName, colors);
        const potmData = await this.dataUrlToUint8Array(potmImg);
        this.ffmpeg.FS('writeFile', 'potm.png', potmData);
        
        await this.ffmpeg.run(
          '-loop', '1', '-i', 'potm.png',
          '-c:v', 'libx264', '-t', '4', '-pix_fmt', 'yuv420p',
          '-vf', 'scale=720:1280',
          '-r', '30', '-y', 'potm.mp4'
        );
        segments.push('potm.mp4');
      }

      // 5. Outro
      this.updateProgress('Creating outro...', 85);
      const outroImg = this.createOutroCard();
      const outroData = await this.dataUrlToUint8Array(outroImg);
      this.ffmpeg.FS('writeFile', 'outro.png', outroData);
      
      await this.ffmpeg.run(
        '-loop', '1', '-i', 'outro.png',
        '-c:v', 'libx264', '-t', '3', '-pix_fmt', 'yuv420p',
        '-vf', 'scale=720:1280',
        '-r', '30', '-y', 'outro.mp4'
      );
      segments.push('outro.mp4');

      // 6. Concatenate all segments
      this.updateProgress('Combining clips...', 90);
      
      // Create concat file
      const concatContent = segments.map(s => `file '${s}'`).join('\n');
      this.ffmpeg.FS('writeFile', 'concat.txt', new TextEncoder().encode(concatContent));

      await this.ffmpeg.run(
        '-f', 'concat', '-safe', '0', '-i', 'concat.txt',
        '-c:v', 'libx264', '-preset', 'fast', '-crf', '23',
        '-c:a', 'aac', '-b:a', '128k',
        '-movflags', '+faststart',
        '-y', 'output.mp4'
      );

      this.updateProgress('Finalizing...', 98);

      // Read the output file
      const outputData = this.ffmpeg.FS('readFile', 'output.mp4');
      
      // Create blob and URL
      const blob = new Blob([outputData.buffer], { type: 'video/mp4' });
      const url = URL.createObjectURL(blob);

      this.updateProgress('Done!', 100);

      return {
        success: true,
        url,
        blob,
        filename: `${teamName}-vs-${opponent}-highlights.mp4`
      };

    } catch (err) {
      console.error('Render error:', err);
      throw err;
    }
  }
}

// Export for use
window.VideoRenderer = VideoRenderer;
