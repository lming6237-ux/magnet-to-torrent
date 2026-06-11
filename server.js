const express = require('express');
const magnetToTorrent = require('./index');

const app = express();
const port = 3000;

app.use(express.json());

app.get('/convert', async (req, res) => {
  const { magnet } = req.query;
  
  if (!magnet) {
    return res.status(400).json({ error: 'Missing magnet parameter' });
  }

  try {
    const torrentUrl = await magnetToTorrent.getLink(magnet);
    res.json({ success: true, torrentUrl });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

app.listen(port, '0.0.0.0', () => {
  console.log(`Server running on http://localhost:${port}`);
});