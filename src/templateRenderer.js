const puppeteer = require('puppeteer');
const path = require('path');
const fs = require('fs');

class TemplateRenderer {
  constructor() {
    this.browser = null;
    this.templatesDir = path.join(__dirname, 'templates');
  }

  async init() {
    if (!this.browser) {
      // Find chromium - check various paths for Railway/Nix
      const chromiumPaths = [
        process.env.PUPPETEER_EXECUTABLE_PATH,
        process.env.CHROMIUM_PATH,
        '/usr/bin/chromium',
        '/usr/bin/chromium-browser',
        '/usr/bin/google-chrome',
        '/nix/var/nix/profiles/default/bin/chromium',
      ].filter(Boolean);
      
      let executablePath = null;
      const fs = require('fs');
      for (const p of chromiumPaths) {
        if (fs.existsSync(p)) {
          executablePath = p;
          break;
        }
      }
      
      console.log('🌐 Launching Puppeteer with:', executablePath || 'bundled chromium');
      
      this.browser = await puppeteer.launch({
        headless: 'new',
        executablePath: executablePath || undefined,
        args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage']
      });
    }
  }

  async close() {
    if (this.browser) {
      await this.browser.close();
      this.browser = null;
    }
  }

  async renderTemplate(templateName, data, outputPath) {
    await this.init();
    
    const templatePath = path.join(this.templatesDir, `${templateName}.html`);
    let html = fs.readFileSync(templatePath, 'utf8');
    
    // Replace placeholders
    for (const [key, value] of Object.entries(data)) {
      const placeholder = `{{${key}}}`;
      html = html.split(placeholder).join(value || '');
    }
    
    const page = await this.browser.newPage();
    await page.setViewport({ width: 1080, height: 1920 });
    await page.setContent(html, { waitUntil: 'networkidle0' });
    
    // Wait a bit for fonts to load
    await new Promise(r => setTimeout(r, 500));
    
    await page.screenshot({ path: outputPath, type: 'png' });
    await page.close();
    
    return outputPath;
  }

  // Render template with transparent background (for overlays)
  async renderOverlay(templateName, data, outputPath) {
    await this.init();
    
    const templatePath = path.join(this.templatesDir, `${templateName}.html`);
    let html = fs.readFileSync(templatePath, 'utf8');
    
    // Replace placeholders
    for (const [key, value] of Object.entries(data)) {
      const placeholder = `{{${key}}}`;
      html = html.split(placeholder).join(value || '');
    }
    
    const page = await this.browser.newPage();
    await page.setViewport({ width: 1080, height: 1920 });
    await page.setContent(html, { waitUntil: 'networkidle0' });
    
    // Wait a bit for fonts to load
    await new Promise(r => setTimeout(r, 500));
    
    // Capture with transparent background
    await page.screenshot({ path: outputPath, type: 'png', omitBackground: true });
    await page.close();
    
    return outputPath;
  }

  // Render intro card
  async renderIntro(data, outputPath, logoPath = null, opponentLogoPath = null) {
    let logoHtml = '<span class="placeholder">⚽</span>';
    if (logoPath && fs.existsSync(logoPath)) {
      const logoBase64 = fs.readFileSync(logoPath).toString('base64');
      const ext = path.extname(logoPath).slice(1);
      logoHtml = `<img src="data:image/${ext};base64,${logoBase64}" />`;
    }
    
    let opponentLogoHtml = '<span class="placeholder">⚽</span>';
    if (opponentLogoPath && fs.existsSync(opponentLogoPath)) {
      const logoBase64 = fs.readFileSync(opponentLogoPath).toString('base64');
      const ext = path.extname(opponentLogoPath).slice(1);
      opponentLogoHtml = `<img src="data:image/${ext};base64,${logoBase64}" />`;
    }
    
    return this.renderTemplate('intro', {
      TEAM_NAME: data.teamName,
      OPPONENT: data.opponent,
      DATE: new Date(data.matchDate).toLocaleDateString('en-GB', {
        weekday: 'short',
        day: 'numeric',
        month: 'short',
        year: 'numeric'
      }),
      TIME: data.matchTime || 'TBC',
      COMPETITION: data.competition || 'MATCH DAY',
      MANAGER: data.manager ? `Manager: ${data.manager}` : '',
      VENUE: data.venue || 'TBC',
      LOGO: logoHtml,
      OPPONENT_LOGO: opponentLogoHtml
    }, outputPath);
  }

  // Render score card
  async renderScore(data, outputPath) {
    const homeWins = data.score.home > data.score.away;
    const awayWins = data.score.away > data.score.home;
    
    return this.renderTemplate('score', {
      TEAM_NAME: data.teamName,
      OPPONENT: data.opponent,
      HOME_SCORE: data.score.home.toString(),
      AWAY_SCORE: data.score.away.toString(),
      HOME_WINNER: homeWins ? 'winner' : '',
      AWAY_WINNER: awayWins ? 'winner' : ''
    }, outputPath);
  }

  // Render POTM card
  async renderPOTM(data, outputPath, photoPath = null, logoPath = null) {
    let photoHtml = '<span class="photo-placeholder">⭐</span>';
    if (photoPath && fs.existsSync(photoPath)) {
      const photoBase64 = fs.readFileSync(photoPath).toString('base64');
      const ext = path.extname(photoPath).slice(1);
      photoHtml = `<img src="data:image/${ext};base64,${photoBase64}" />`;
    }
    
    let logoHtml = '';
    if (logoPath && fs.existsSync(logoPath)) {
      const logoBase64 = fs.readFileSync(logoPath).toString('base64');
      const ext = path.extname(logoPath).slice(1);
      logoHtml = `<img src="data:image/${ext};base64,${logoBase64}" />`;
    }
    
    const colors = data.colors || { primary: '#0099cc', secondary: '#00ccff' };
    
    return this.renderTemplate('potm', {
      PLAYER_NAME: data.playerOfMatch,
      TEAM_NAME: data.teamName,
      OPPONENT: data.opponent,
      MATCH_DATE: new Date(data.matchDate).toLocaleDateString('en-GB', { day: '2-digit', month: '2-digit', year: '2-digit' }),
      PHOTO: photoHtml,
      LOGO: logoHtml,
      PRIMARY_COLOR: colors.primary,
      SECONDARY_COLOR: colors.secondary
    }, outputPath);
  }

  // Render team slide
  async renderTeamSlide(data, outputPath, teamPhotoPath = null, logoPath = null) {
    let photoHtml = '<span class="photo-placeholder">👥</span>';
    if (teamPhotoPath && fs.existsSync(teamPhotoPath)) {
      const photoBase64 = fs.readFileSync(teamPhotoPath).toString('base64');
      const ext = path.extname(teamPhotoPath).slice(1);
      photoHtml = `<img src="data:image/${ext};base64,${photoBase64}" />`;
    }
    
    let logoHtml = '';
    if (logoPath && fs.existsSync(logoPath)) {
      const logoBase64 = fs.readFileSync(logoPath).toString('base64');
      const ext = path.extname(logoPath).slice(1);
      logoHtml = `<img src="data:image/${ext};base64,${logoBase64}" />`;
    }
    
    const colors = data.colors || { primary: '#0099cc', secondary: '#00ccff' };
    const playerListHtml = (data.squad || []).map(p => `<li>${p}</li>`).join('');
    
    return this.renderTemplate('team-slide', {
      TEAM_NAME: data.teamName,
      OPPONENT: data.opponent,
      MATCH_DATE: new Date(data.matchDate).toLocaleDateString('en-GB', { day: '2-digit', month: '2-digit', year: '2-digit' }),
      TEAM_PHOTO: photoHtml,
      LOGO: logoHtml,
      PLAYER_LIST: playerListHtml,
      PRIMARY_COLOR: colors.primary,
      SECONDARY_COLOR: colors.secondary
    }, outputPath);
  }

  // Render section header (Goals, Saves, Skills)
  async renderSectionHeader(title, icon, color, outputPath) {
    const colors = {
      green: { accent: '#00ff88', glow: 'rgba(0, 255, 136, 0.15)' },
      blue: { accent: '#00d4ff', glow: 'rgba(0, 212, 255, 0.15)' },
      orange: { accent: '#ffa502', glow: 'rgba(255, 165, 2, 0.15)' },
      red: { accent: '#ff0050', glow: 'rgba(255, 0, 80, 0.15)' },
      gold: { accent: '#ffd700', glow: 'rgba(255, 215, 0, 0.15)' }
    };
    
    const c = colors[color] || colors.green;
    
    return this.renderTemplate('section-header', {
      TITLE: title,
      ICON: icon,
      ACCENT_COLOR: c.accent,
      GLOW_COLOR: c.glow
    }, outputPath);
  }

  // Render goal overlay (lower third) - transparent
  async renderGoalOverlay(scorer, outputPath, colors = null) {
    const c = colors || { primary: '#00aa00', secondary: '#00dd44' };
    return this.renderOverlay('goal-overlay', {
      SCORER: scorer,
      PRIMARY_COLOR: c.primary,
      SECONDARY_COLOR: c.secondary
    }, outputPath);
  }

  // Render chance overlay - transparent
  async renderChanceOverlay(player, outputPath, colors = null) {
    const c = colors || { primary: '#ffa502', secondary: '#ffcc00' };
    return this.renderOverlay('chance-overlay', {
      PLAYER: player || '',
      PRIMARY_COLOR: c.primary,
      SECONDARY_COLOR: c.secondary
    }, outputPath);
  }

  // Render opposition goal overlay (CONCEDED) - transparent
  async renderOppGoalOverlay(opponent, outputPath) {
    return this.renderOverlay('opp-goal-overlay', {
      OPPONENT: opponent
    }, outputPath);
  }

  // Render skills overlay (lower third badge) - transparent
  async renderSkillsOverlay(outputPath) {
    return this.renderOverlay('skills-overlay', {}, outputPath);
  }

  // Render celebration overlay (GET IN! SCENES!) - transparent
  async renderCelebrationOverlay(outputPath) {
    return this.renderOverlay('celebration-overlay', {}, outputPath);
  }

  // Render team of the day
  async renderTeamOfDay(players, outputPath) {
    const playersHtml = players.map(p => `<div class="player">${p}</div>`).join('');
    
    return this.renderTemplate('team-of-day', {
      PLAYERS: playersHtml
    }, outputPath);
  }

  // Render outro
  async renderOutro(outputPath) {
    return this.renderTemplate('outro', {}, outputPath);
  }
}

module.exports = TemplateRenderer;
