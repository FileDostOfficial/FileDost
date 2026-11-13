const express = require('express');
const cors = require('cors');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const { initializeApp, cert } = require('firebase-admin/app');
const { getAuth } = require('firebase-admin/auth');

const serviceAccount = process.env.FIREBASE_SERVICE_ACCOUNT
  ? JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT)
  : require('./serviceAccountKey.json');

initializeApp({
  credential: cert(serviceAccount)
});

const app = express();
const PORT = process.env.PORT || 3000;
const ADMIN_EMAIL = 'nishadsatyam238@gmail.com';
const uploadDir = path.join(__dirname, 'uploads');
const dataFile = path.join(__dirname, 'videos.json');

if (!fs.existsSync(uploadDir)) fs.mkdirSync(uploadDir);
if (!fs.existsSync(dataFile)) fs.writeFileSync(dataFile, '[]');

const getVideos = () => JSON.parse(fs.readFileSync(dataFile, 'utf8'));
const saveVideos = videos =>
  fs.writeFileSync(dataFile, JSON.stringify(videos, null, 2));

app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));
app.use('/videos', express.static(uploadDir));

async function requireAdmin(req, res, next) {
  const header = req.headers.authorization || '';

  if (!header.startsWith('Bearer ')) {
    return res.status(401).json({ message: 'Login required' });
  }

  try {
    const decoded = await getAuth().verifyIdToken(header.slice(7));

    if (decoded.email !== ADMIN_EMAIL) {
      return res.status(403).json({ message: 'Admin only' });
    }

    req.adminUser = decoded;
    next();
  } catch (error) {
    return res.status(401).json({ message: 'Invalid login token' });
  }
}

// Login required for video uploads
async function requireUser(req, res, next) {
  const header = req.headers.authorization || '';

  if (!header.startsWith('Bearer ')) {
    return res.status(401).json({ message: 'Please login first' });
  }

  try {
    req.user = await getAuth().verifyIdToken(header.slice(7));
    next();
  } catch (error) {
    return res.status(401).json({ message: 'Invalid login token' });
  }
}

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
  res.json(getVideos());
});

// Count each successful video download
app.get('/api/download/:id', (req, res) => {
  try {
    const videos = getVideos();
    const video = videos.find(v => String(v.id) === req.params.id);
    if (!video) return res.status(404).json({ message: 'Video nahi mila' });

    const filename = path.basename(video.filename);
    const filePath = path.join(uploadDir, filename);
    if (!fs.existsSync(filePath)) {
      return res.status(404).json({ message: 'Video file nahi mili' });
    }

    video.downloads = (video.downloads || 0) + 1;
    saveVideos(videos);

    const downloadName = (video.title || 'FileDost-video') + path.extname(filename);
    res.download(filePath, downloadName);
  } catch (error) {
    res.status(500).json({ message: 'Download failed' });
  }
});

app.post('/api/upload', requireUser, upload.single('video'), (req, res) => {
  if (!req.file) {
    return res.status(400).json({ message: 'Video select karo' });
  }

  const videos = getVideos();
  const video = {
    id: Date.now(),
    title: path.parse(req.file.originalname).name,
    filename: req.file.filename,
    url: '/videos/' + req.file.filename,
    size: req.file.size,
    downloads: 0
  };

  videos.unshift(video);
  saveVideos(videos);
  res.json({ message: 'Video upload ho gaya!', video });
});

// ADMIN: Dashboard counts
app.get('/api/admin/stats', requireAdmin, async (req, res) => {
  try {
    let totalUsers = 0;
    let pageToken;

    do {
      const result = await getAuth().listUsers(1000, pageToken);
      totalUsers += result.users.length;
      pageToken = result.pageToken;
    } while (pageToken);

    const videos = getVideos();
    let totalStorage = 0;
    let totalDownloads = 0;

    videos.forEach(video => {
      totalDownloads += Number(video.downloads || 0);
      if (Number(video.size) > 0) {
        totalStorage += Number(video.size);
      } else {
        const filePath = path.join(uploadDir, path.basename(video.filename || ''));
        if (fs.existsSync(filePath)) totalStorage += fs.statSync(filePath).size;
      }
    });

    res.json({
      users: totalUsers,
      videos: videos.length,
      downloads: totalDownloads,
      storage: totalStorage
    });
  } catch (error) {
    res.status(500).json({ message: 'Stats load nahi hue' });
  }
});

// ADMIN: All users
app.get('/api/admin/users', requireAdmin, async (req, res) => {
  try {
    let users = [];
    let pageToken;

    do {
      const result = await getAuth().listUsers(1000, pageToken);
      users = users.concat(result.users);
      pageToken = result.pageToken;
    } while (pageToken);

    res.json(users.map(user => ({
      uid: user.uid,
      email: user.email || '',
      name: user.displayName || '',
      created: user.metadata.creationTime,
      lastLogin: user.metadata.lastSignInTime,
      disabled: user.disabled
    })));
  } catch (error) {
    res.status(500).json({ message: 'Users load nahi hue' });
  }
});

// ADMIN: All videos
app.get('/api/admin/videos', requireAdmin, (req, res) => {
  res.json(getVideos());
});

// ADMIN: Delete video
app.delete('/api/admin/videos/:id', requireAdmin, (req, res) => {
  try {
    const videos = getVideos();
    const video = videos.find(v => String(v.id) === req.params.id);

    if (!video) {
      return res.status(404).json({ message: 'Video nahi mila' });
    }

    const filename = path.basename(video.filename);
    const filePath = path.join(uploadDir, filename);

    if (path.dirname(filePath) === uploadDir && fs.existsSync(filePath)) {
      fs.unlinkSync(filePath);
    }

    saveVideos(videos.filter(v => String(v.id) !== req.params.id));
    res.json({ message: 'Video delete ho gaya' });
  } catch (error) {
    res.status(500).json({ message: 'Video delete nahi hua' });
  }
});

app.listen(PORT, '0.0.0.0', () => {
  console.log(`FileDost running on port ${PORT}`);
});
