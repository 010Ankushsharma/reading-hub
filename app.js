/**
 * Web Reading Hub - Main Application
 * Uses MongoDB Atlas with GridFS for file storage
 */

// Load environment variables
require('dotenv').config();

const express = require('express');
const mongoose = require('mongoose');
const path = require('path');
const methodOverride = require('method-override');
const session = require('express-session');
const flash = require('connect-flash');
const multer = require('multer');
const { GridFsStorage } = require('multer-gridfs-storage');
const crypto = require('crypto');
const dns = require('dns');

// Import routes
const bookRoutes = require('./routes/books');
const shelfRoutes = require('./routes/shelves');

// Initialize Express app
const app = express();
const PORT = process.env.PORT || 3000;

// MongoDB Atlas Connection
const mongoURI = process.env.MONGODB_URI;

// DNS workaround: Set custom DNS servers for Node.js (only in development)
if (process.env.NODE_ENV !== 'production') {
    dns.setServers(['8.8.8.8', '8.8.4.4']);
}

// Create MongoDB connection for GridFS
const conn = mongoose.createConnection(mongoURI);

// Handle connection errors
conn.on('error', (err) => {
    console.error('GridFS connection error:', err.message);
});

// Initialize GridFS
let gfs, gridfsBucket;
conn.once('open', () => {
    gridfsBucket = new mongoose.mongo.GridFSBucket(conn.db, {
        bucketName: 'uploads'
    });
    gfs = gridfsBucket;
    console.log('✅ GridFS initialized successfully');
});

// File filter to accept only PDFs and images
const fileFilter = (req, file, cb) => {
    if (file.fieldname === 'pdfFile') {
        if (file.mimetype === 'application/pdf') {
            cb(null, true);
        } else {
            cb(new Error('Only PDF files are allowed!'), false);
        }
    } else if (file.fieldname === 'coverImageFile') {
        if (file.mimetype.startsWith('image/')) {
            cb(null, true);
        } else {
            cb(new Error('Only image files are allowed for cover!'), false);
        }
    } else {
        cb(null, true);
    }
};

// Create storage engine for GridFS - use existing connection
let storage;
let upload;

// Initialize storage after connection is open
conn.once('open', () => {
    storage = new GridFsStorage({
        db: conn.db,
        file: (req, file) => {
            return new Promise((resolve, reject) => {
                crypto.randomBytes(16, (err, buf) => {
                    if (err) return reject(err);
                    const filename = buf.toString('hex') + path.extname(file.originalname);
                    resolve({
                        filename: filename,
                        bucketName: 'uploads',
                        metadata: {
                            originalname: file.originalname,
                            uploadDate: new Date(),
                            contentType: file.mimetype
                        }
                    });
                });
            });
        }
    });
    
    // Create upload middleware after storage is ready
    upload = multer({ 
        storage: storage,
        fileFilter: fileFilter,
        limits: {
            fileSize: 50 * 1024 * 1024 // 50MB limit
        }
    });
    
    // Make upload middleware available after storage is ready
    app.locals.upload = upload;
    console.log('✅ Upload middleware initialized');
});

// Make gfs available to routes
app.locals.gfs = () => gfs;

// Connect to MongoDB for models
mongoose.connect(mongoURI)
    .then(() => {
        console.log('✅ Connected to MongoDB Atlas successfully');
    })
    .catch((err) => {
        console.error('❌ MongoDB Atlas connection error:', err.message);
        console.log('\n⚠️  Please check your MONGODB_URI in .env file');
        console.log('Make sure you have:');
        console.log('1. Correct username and password');
        console.log('2. Your IP address whitelisted in MongoDB Atlas');
        console.log('3. Internet connection\n');
    });

// Set up view engine
app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));

// Middleware
app.use(express.urlencoded({ extended: true }));
app.use(express.json());
app.use(methodOverride('_method'));
app.use(express.static(path.join(__dirname, 'public')));

// Session middleware
app.use(session({
    secret: process.env.SESSION_SECRET || 'reading-hub-secret-key',
    resave: false,
    saveUninitialized: false,
    cookie: { 
        secure: process.env.NODE_ENV === 'production',
        maxAge: 24 * 60 * 60 * 1000,
        sameSite: 'lax'
    },
    name: 'readingHub.sid'
}));

// Flash messages middleware
app.use(flash());

// Global variables middleware
app.use((req, res, next) => {
    res.locals.success_msg = req.flash('success');
    res.locals.error_msg = req.flash('error');
    res.locals.currentPath = req.path;
    next();
});

// GridFS file serving route
app.get('/files/:filename', async (req, res) => {
    try {
        if (!gfs) {
            return res.status(503).send('GridFS not initialized');
        }
        
        const file = await conn.db.collection('uploads.files').findOne({ filename: req.params.filename });
        
        if (!file) {
            return res.status(404).send('File not found');
        }
        
        const readStream = gfs.openDownloadStreamByName(req.params.filename);
        res.set('Content-Type', file.metadata.contentType);
        readStream.pipe(res);
    } catch (err) {
        console.error('Error serving file:', err);
        res.status(500).send('Error serving file');
    }
});

// Routes
app.use('/books', bookRoutes);
app.use('/shelves', shelfRoutes);

// Health check endpoint for Render
app.get('/health', (req, res) => {
    res.status(200).json({ 
        status: 'OK', 
        timestamp: new Date().toISOString(),
        mongodb: mongoose.connection.readyState === 1 ? 'connected' : 'disconnected'
    });
});

// Home route
app.get('/', (req, res) => {
    res.redirect('/books');
});

// 404 handler
app.use((req, res) => {
    res.status(404).render('error', { 
        title: 'Page Not Found',
        message: 'The page you are looking for does not exist.'
    });
});

// Error handling middleware
app.use((err, req, res, next) => {
    console.error(err.stack);
    
    if (err instanceof multer.MulterError) {
        if (err.code === 'LIMIT_FILE_SIZE') {
            req.flash('error', 'File size too large. Maximum size is 50MB.');
            return res.redirect('back');
        }
    }
    
    req.flash('error', err.message || 'Something went wrong!');
    res.redirect('back');
});

// Start server
app.listen(PORT, () => {
    console.log(`🚀 Server running on http://localhost:${PORT}`);
    console.log(`🌍 Environment: ${process.env.NODE_ENV || 'development'}`);
});

module.exports = app;
