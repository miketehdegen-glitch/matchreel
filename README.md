# MatchReel ⚽🎬

Turn your team's match clips into epic highlight reels — powered by parents, created automatically.

## The Product

**Price:** £3 per match

**Flow:**
1. Team admin creates a match and adds squad list
2. Gets a shareable link to send to WhatsApp group
3. Parents upload clips and tag them (Goal/Chance/Save)
4. Admin enters final score, picks Player of the Match
5. System generates highlight reel with music

**What you get:**
- Intro with team names
- Goals with scorer names + minute
- Key saves and chances
- Final score graphic
- Player of the Match feature
- Epic background music

## Pages

| URL | Purpose |
|-----|---------|
| `/` | Landing page |
| `/create` | Admin creates new match |
| `/match/:id` | Parents upload clips here |
| `/admin/:id?token=xxx` | Admin dashboard |

## Tech Stack

- **Frontend:** Vanilla HTML/CSS/JS (no framework needed)
- **Backend:** Node.js + Express
- **Storage:** JSON file (MVP) → Database later
- **Video:** FFmpeg
- **Payments:** Stripe (TODO)

## Quick Start

```bash
# Install dependencies
cd matchreel
npm install

# Install FFmpeg (Windows)
winget install FFmpeg

# Run dev server
npm run dev

# Open http://localhost:3000
```

## Project Structure

```
matchreel/
├── public/
│   ├── index.html      # Landing page
│   ├── create.html     # Create match form
│   ├── upload.html     # Parent upload page
│   └── admin.html      # Admin dashboard
├── src/
│   ├── server.js       # Express API
│   └── videoProcessor.js # FFmpeg logic
├── data/
│   └── matches.json    # Match data storage
├── uploads/            # Uploaded video clips
├── output/             # Generated reels
└── package.json
```

## API Endpoints

```
POST   /api/matches              # Create match
GET    /api/matches/:id          # Get match details
POST   /api/matches/:id/clips    # Upload clip
PUT    /api/matches/:id          # Update match (admin)
POST   /api/matches/:id/generate # Generate reel (admin)
```

## TODO

### MVP (This Week)
- [x] Landing page
- [x] Create match flow
- [x] Parent upload with tagging (goal/chance/save)
- [x] Admin dashboard
- [ ] FFmpeg video processing
- [ ] Stripe payment integration
- [ ] Email delivery

### V1.1
- [ ] Intro/outro graphics
- [ ] Player of the Match title card
- [ ] Music overlay
- [ ] Score graphic generation
- [ ] Multiple music options

### V2 (Future)
- [ ] WhatsApp bot integration
- [ ] Team subscriptions
- [ ] Custom branding
- [ ] Mobile app

## Environment Variables

```env
PORT=3000
STRIPE_SECRET_KEY=sk_xxx
STRIPE_PRICE_ID=price_xxx
SENDGRID_API_KEY=xxx
```

---

Built by Michael 🏗️
