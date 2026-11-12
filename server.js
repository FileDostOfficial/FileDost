const express = require('express');
const cors = require('cors');
const multer = require('multer');
const path = require('path');
const fs = require('fs');

const app = express();
const PORT = process.env.PORT || 3000;
const uploadDir = path.join(__dirname, 'uploads');
const dataFile = path.join(__dirname, 'videos.json');

if (!fs.existsSync(uploadDir)) fs.mkdirSync(uploadDir);
if (!fs.existsSync(dataFile)) fs.writeFileSync(dataFile, '[]');

app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));
app.use('/videos', express.static(uploadDir));

const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, uploadDir),
  filename: (req, file, cb) =>
    cb(null, Date.now() + path.extname(file.originalname))
});

const upload = multer({
  storage,
  limits: { fileSize: 500 * 1024 * 1024 }
});

app.get('/api/videos', (req, res) => {
  res.json(JSON.parse(fs.readFileSync(dataFile)));
});

app.post('/api/upload', upload.single('video'), (req, res) => {
  if (!req.file) return res.status(400).json({ message: 'Video select karo' });

  const videos = JSON.parse(fs.readFileSync(dataFile));
  const video = {
    id: Date.now(),
    title: path.parse(req.file.originalname).name,
    filename: req.file.filename,
    url: '/videos/' + req.file.filename
  };

  videos.unshift(video);
  fs.writeFileSync(dataFile, JSON.stringify(videos, null, 2));
  res.json({ message: 'Video upload ho gaya!', video });
});

app.listen(PORT, '0.0.0.0', () => {
  console.log(`FileDost running on port ${PORT}`);
});
