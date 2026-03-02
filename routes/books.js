/**
 * Book Routes
 * Handles all CRUD operations for books with GridFS storage
 */
const express = require('express');
const router = express.Router();
const { body, validationResult } = require('express-validator');
const Book = require('../models/Book');
const Shelf = require('../models/Shelf');

// Validation rules
const bookValidation = [
    body('title')
        .trim()
        .notEmpty().withMessage('Title is required')
        .isLength({ max: 200 }).withMessage('Title cannot exceed 200 characters'),
    body('author')
        .trim()
        .notEmpty().withMessage('Author is required')
        .isLength({ max: 100 }).withMessage('Author name cannot exceed 100 characters'),
    body('description')
        .trim()
        .optional()
        .isLength({ max: 2000 }).withMessage('Description cannot exceed 2000 characters'),
    body('genre')
        .trim()
        .optional()
        .isLength({ max: 50 }).withMessage('Genre cannot exceed 50 characters'),
    body('coverImage')
        .trim()
        .optional()
        .isURL().withMessage('Cover image must be a valid URL')
];

/**
 * GET /books - List all books with pagination and search
 */
router.get('/', async (req, res) => {
    try {
        const page = parseInt(req.query.page) || 1;
        const limit = parseInt(req.query.limit) || 12;
        const search = req.query.search || '';
        const skip = (page - 1) * limit;

        let query = {};
        
        if (search) {
            query = {
                $or: [
                    { title: { $regex: search, $options: 'i' } },
                    { author: { $regex: search, $options: 'i' } },
                    { genre: { $regex: search, $options: 'i' } }
                ]
            };
        }

        const totalBooks = await Book.countDocuments(query);
        const totalPages = Math.ceil(totalBooks / limit);

        const books = await Book.find(query)
            .sort({ createdAt: -1 })
            .skip(skip)
            .limit(limit);

        res.render('books/index', {
            title: search ? `Search: ${search}` : 'All Books',
            books,
            currentPage: page,
            totalPages,
            totalBooks,
            limit,
            search,
            hasNextPage: page < totalPages,
            hasPrevPage: page > 1,
            nextPage: page + 1,
            prevPage: page - 1
        });
    } catch (err) {
        console.error('Error fetching books:', err);
        req.flash('error', 'Failed to load books. Please try again.');
        res.render('books/index', {
            title: 'All Books',
            books: [],
            currentPage: 1,
            totalPages: 0,
            totalBooks: 0,
            limit: 12,
            search: '',
            hasNextPage: false,
            hasPrevPage: false,
            nextPage: 2,
            prevPage: 0
        });
    }
});

/**
 * GET /books/new - Show form to add new book
 */
router.get('/new', async (req, res) => {
    try {
        const shelves = await Shelf.find().sort({ name: 1 });
        res.render('books/new', {
            title: 'Add New Book',
            book: null,
            shelves,
            errors: []
        });
    } catch (err) {
        console.error('Error fetching shelves:', err);
        res.render('books/new', {
            title: 'Add New Book',
            book: null,
            shelves: [],
            errors: []
        });
    }
});

/**
 * POST /books - Create new book
 */
router.post('/', 
    (req, res, next) => {
        req.app.locals.upload.fields([
            { name: 'pdfFile', maxCount: 1 },
            { name: 'coverImageFile', maxCount: 1 }
        ])(req, res, next);
    },
    bookValidation,
    async (req, res) => {
        try {
            const errors = validationResult(req);
            if (!errors.isEmpty()) {
                const shelves = await Shelf.find().sort({ name: 1 });
                return res.render('books/new', {
                    title: 'Add New Book',
                    book: req.body,
                    shelves,
                    errors: errors.array()
                });
            }

            if (!req.files || !req.files.pdfFile) {
                const shelves = await Shelf.find().sort({ name: 1 });
                return res.render('books/new', {
                    title: 'Add New Book',
                    book: req.body,
                    shelves,
                    errors: [{ msg: 'PDF file is required' }]
                });
            }

            const bookData = {
                title: req.body.title,
                author: req.body.author,
                description: req.body.description,
                genre: req.body.genre,
                pdfFile: req.files.pdfFile[0].filename,
                shelf: req.body.shelf || null
            };

            if (req.files.coverImageFile && req.files.coverImageFile[0]) {
                bookData.coverImage = '/files/' + req.files.coverImageFile[0].filename;
            } else if (req.body.coverImage) {
                bookData.coverImage = req.body.coverImage;
            }

            const book = new Book(bookData);
            await book.save();

            req.flash('success', 'Book added successfully!');
            res.redirect('/books');
        } catch (err) {
            console.error('Error creating book:', err);
            req.flash('error', 'Failed to add book. Please try again.');
            res.redirect('/books/new');
        }
    }
);

/**
 * GET /books/:id - Show single book details
 */
router.get('/:id', async (req, res) => {
    try {
        const book = await Book.findById(req.params.id);
        
        if (!book) {
            req.flash('error', 'Book not found');
            return res.redirect('/books');
        }

        res.render('books/show', {
            title: book.title,
            book
        });
    } catch (err) {
        console.error('Error fetching book:', err);
        req.flash('error', 'Failed to load book details.');
        res.redirect('/books');
    }
});

/**
 * GET /books/:id/edit - Show edit form
 */
router.get('/:id/edit', async (req, res) => {
    try {
        const book = await Book.findById(req.params.id);
        const shelves = await Shelf.find().sort({ name: 1 });
        
        if (!book) {
            req.flash('error', 'Book not found');
            return res.redirect('/books');
        }

        res.render('books/edit', {
            title: `Edit: ${book.title}`,
            book,
            shelves,
            errors: []
        });
    } catch (err) {
        console.error('Error fetching book for edit:', err);
        req.flash('error', 'Failed to load book for editing.');
        res.redirect('/books');
    }
});

/**
 * PUT /books/:id - Update book
 */
router.put('/:id',
    (req, res, next) => {
        req.app.locals.upload.fields([
            { name: 'pdfFile', maxCount: 1 },
            { name: 'coverImageFile', maxCount: 1 }
        ])(req, res, next);
    },
    bookValidation,
    async (req, res) => {
        try {
            const book = await Book.findById(req.params.id);
            
            if (!book) {
                req.flash('error', 'Book not found');
                return res.redirect('/books');
            }

            const errors = validationResult(req);
            if (!errors.isEmpty()) {
                const shelves = await Shelf.find().sort({ name: 1 });
                return res.render('books/edit', {
                    title: `Edit: ${book.title}`,
                    book: { ...book.toObject(), ...req.body },
                    shelves,
                    errors: errors.array()
                });
            }

            const gfs = req.app.locals.gfs();

            book.title = req.body.title;
            book.author = req.body.author;
            book.description = req.body.description;
            book.genre = req.body.genre;
            book.shelf = req.body.shelf || null;

            if (req.files.coverImageFile && req.files.coverImageFile[0]) {
                if (book.coverImage && book.coverImage.startsWith('/files/')) {
                    const oldFilename = book.coverImage.replace('/files/', '');
                    const oldFile = await mongoose.connection.db.collection('uploads.files').findOne({ filename: oldFilename });
                    if (oldFile) {
                        await gfs.delete(oldFile._id);
                    }
                }
                book.coverImage = '/files/' + req.files.coverImageFile[0].filename;
            } else if (req.body.coverImage) {
                book.coverImage = req.body.coverImage;
            }

            if (req.files.pdfFile && req.files.pdfFile[0]) {
                const oldPdfFile = await mongoose.connection.db.collection('uploads.files').findOne({ filename: book.pdfFile });
                if (oldPdfFile) {
                    await gfs.delete(oldPdfFile._id);
                }
                book.pdfFile = req.files.pdfFile[0].filename;
            }

            await book.save();

            req.flash('success', 'Book updated successfully!');
            res.redirect(`/books/${book._id}`);
        } catch (err) {
            console.error('Error updating book:', err);
            req.flash('error', 'Failed to update book. Please try again.');
            res.redirect(`/books/${req.params.id}/edit`);
        }
    }
);

/**
 * DELETE /books/:id - Delete book
 */
router.delete('/:id', async (req, res) => {
    try {
        const deletePassword = req.body.deletePassword;
        if (deletePassword !== process.env.DELETE_PASSWORD) {
            req.flash('error', 'Invalid delete password. Book was not deleted.');
            return res.redirect('back');
        }

        const book = await Book.findById(req.params.id);
        
        if (!book) {
            req.flash('error', 'Book not found');
            return res.redirect('/books');
        }

        const gfs = req.app.locals.gfs();

        const pdfFile = await mongoose.connection.db.collection('uploads.files').findOne({ filename: book.pdfFile });
        if (pdfFile) {
            await gfs.delete(pdfFile._id);
        }

        if (book.coverImage && book.coverImage.startsWith('/files/')) {
            const coverFilename = book.coverImage.replace('/files/', '');
            const coverFile = await mongoose.connection.db.collection('uploads.files').findOne({ filename: coverFilename });
            if (coverFile) {
                await gfs.delete(coverFile._id);
            }
        }

        await Book.findByIdAndDelete(req.params.id);

        req.flash('success', 'Book deleted successfully!');
        res.redirect('/books');
    } catch (err) {
        console.error('Error deleting book:', err);
        req.flash('error', 'Failed to delete book. Please try again.');
        res.redirect('/books');
    }
});

/**
 * GET /books/:id/download - Download PDF
 */
router.get('/:id/download', async (req, res) => {
    try {
        const book = await Book.findById(req.params.id);
        
        if (!book) {
            req.flash('error', 'Book not found');
            return res.redirect('/books');
        }

        book.downloadCount += 1;
        await book.save();

        const file = await mongoose.connection.db.collection('uploads.files').findOne({ filename: book.pdfFile });
        
        if (!file) {
            req.flash('error', 'PDF file not found');
            return res.redirect(`/books/${book._id}`);
        }

        const gfs = req.app.locals.gfs();
        const readStream = gfs.openDownloadStreamByName(book.pdfFile);
        
        res.set('Content-Type', 'application/pdf');
        res.set('Content-Disposition', `attachment; filename="${book.title}.pdf"`);
        readStream.pipe(res);
    } catch (err) {
        console.error('Error downloading book:', err);
        req.flash('error', 'Failed to download book.');
        res.redirect('/books');
    }
});

module.exports = router;
