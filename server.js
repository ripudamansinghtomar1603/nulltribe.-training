const express = require('express');
const cors = require('cors');
const jwt = require('jsonwebtoken');
const PDFDocument = require('pdfkit');

const app = express();

// Enable CORS for frontend communication (supports requests from GitHub Pages)
app.use(cors());
app.use(express.json());

// In production, change this to a strong environmental variable (e.g., process.env.JWT_SECRET)
const SECRET_KEY = 'your-super-secret-key-change-this-in-production';

// --- MOCK DATABASE ---
// Reset on server restarts. Replace with a real persistent database (MongoDB/PostgreSQL) for production.
const users = [];       // Array of objects: { id, name, email, password }
const progressDb = {};  // Object mapping: { userId: [false, false, false, false] }

// --- AUTHENTICATION MIDDLEWARE ---
const authenticateToken = (req, res, next) => {
    const authHeader = req.headers['authorization'];
    const token = authHeader && authHeader.split(' ')[1];
    
    if (!token) {
        return res.status(401).json({ error: 'Access denied. Authentication token missing.' });
    }

    jwt.verify(token, SECRET_KEY, (err, user) => {
        if (err) {
            return res.status(403).json({ error: 'Invalid or expired session token. Please log in again.' });
        }
        req.user = user;
        next();
    });
};

// --- API ROUTES ---

/**
 * @route   POST /api/signup
 * @desc    Register a new student account
 */
app.post('/api/signup', (req, res) => {
    const { name, email, password } = req.body;

    if (!name || !email || !password) {
        return res.status(400).json({ error: 'All fields (name, email, password) are required.' });
    }

    if (users.find(u => u.email.toLowerCase() === email.toLowerCase())) {
        return res.status(400).json({ error: 'An account with this email address already exists.' });
    }
    
    const newUser = { 
        id: Date.now().toString(), 
        name: name.trim(), 
        email: email.toLowerCase().trim(), 
        password 
    };
    
    users.push(newUser);
    progressDb[newUser.id] = [false, false, false, false]; // Initialize scenario tracker array
    
    // Generate a secure JWT valid for 24 hours
    const token = jwt.sign({ id: newUser.id, name: newUser.name }, SECRET_KEY, { expiresIn: '24h' });
    
    res.status(201).json({ 
        token, 
        user: { name: newUser.name, email: newUser.email },
        progress: progressDb[newUser.id]
    });
});

/**
 * @route   POST /api/login
 * @desc    Authenticate returning student and retrieve progress
 */
app.post('/api/login', (req, res) => {
    const { email, password } = req.body;

    if (!email || !password) {
        return res.status(400).json({ error: 'Email and password are required.' });
    }

    const user = users.find(u => u.email.toLowerCase() === email.toLowerCase().trim() && u.password === password);
    
    if (!user) {
        return res.status(400).json({ error: 'Invalid email or password credentials.' });
    }
    
    const token = jwt.sign({ id: user.id, name: user.name }, SECRET_KEY, { expiresIn: '24h' });
    
    res.json({ 
        token, 
        user: { name: user.name, email: user.email },
        progress: progressDb[user.id] || [false, false, false, false] 
    });
});

/**
 * @route   POST /api/progress
 * @desc    Update and check off a completed scenario index
 */
app.post('/api/progress', authenticateToken, (req, res) => {
    const { scenarioIndex } = req.body;
    
    if (scenarioIndex === undefined || scenarioIndex < 0 || scenarioIndex > 3) {
        return res.status(400).json({ error: 'Invalid scenario index. Must be a value between 0 and 3.' });
    }
    
    if (!progressDb[req.user.id]) {
        progressDb[req.user.id] = [false, false, false, false];
    }
    
    progressDb[req.user.id][scenarioIndex] = true;
    
    res.json({ 
        success: true, 
        progress: progressDb[req.user.id] 
    });
});

/**
 * @route   GET /api/certificate
 * @desc    Generate and stream completion PDF certificate
 */
app.get('/api/certificate', authenticateToken, (req, res) => {
    const userProgress = progressDb[req.user.id];
    
    // Verify that all 4 modules are completed before granting the certificate
    if (!userProgress || !userProgress.every(Boolean)) {
        return res.status(403).json({ error: 'Access denied. Complete all four training scenarios to unlock your certificate.' });
    }

    // Initialize landscape landscape PDF doc
    const doc = new PDFDocument({ layout: 'landscape', size: 'A4' });

    // Set download headers for the client browser
    const sanitizedFilename = req.user.name.replace(/[^a-z0-9]/gi, '_').toLowerCase();
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="nulltribe_${sanitizedFilename}_certificate.pdf"`);
    
    doc.pipe(res);

    // --- DRAW CERTIFICATE INTERFACE ---
    
    // Geometric Border Accent
    doc.rect(25, 20, doc.page.width - 50, doc.page.height - 40).lineWidth(3).stroke('#3B65E8');
    doc.rect(32, 27, doc.page.width - 64, doc.page.height - 54).lineWidth(1).stroke('#E4E8F0');
    
    // Brand Header: nulltribe.
    doc.fontSize(28).font('Helvetica-Bold')
       .fillColor('#3B65E8').text('null', 0, 75, { align: 'center', continued: true })
       .fillColor('#1A1F2E').text('tribe', { continued: true })
       .fillColor('#F97316').text('.');

    // Sub-eyebrow
    doc.moveDown(0.5);
    doc.fontSize(10).font('Helvetica-Bold').fillColor('#8892A4').text('SECURITY ORCHESTRATOR PLATFORM', { align: 'center', letterSpacing: 2 });
    
    // Certificate Core Text
    doc.moveDown(1.5);
    doc.fontSize(38).font('Helvetica-Bold').fillColor('#1A1F2E').text('Certificate of Completion', { align: 'center' });
    
    doc.moveDown(1);
    doc.fontSize(15).font('Helvetica').fillColor('#4A5568').text('This credential validates that', { align: 'center' });
    
    // Recipient Name
    doc.moveDown(0.6);
    doc.fontSize(32).font('Helvetica-Bold').fillColor('#3B65E8').text(req.user.name, { align: 'center' });
    
    // Underline for recipient name
    const nameWidth = doc.widthOfString(req.user.name);
    doc.moveTo((doc.page.width / 2) - (nameWidth / 2), doc.y + 4)
       .lineTo((doc.page.width / 2) + (nameWidth / 2), doc.y + 4)
       .lineWidth(1.5)
       .stroke('#3B65E8');
    
    // Course details
    doc.moveDown(1.4);
    doc.fontSize(14).font('Helvetica').fillColor('#4A5568').text('has successfully reviewed and mastered all interactive modules for:', { align: 'center' });
    doc.moveDown(0.4);
    doc.fontSize(20).font('Helvetica-Bold').fillColor('#1A1F2E').text('Information Security Risk Fundamentals — Phase 1', { align: 'center' });
    
    // Footer metadata blocks (Date and Authentication validation)
    const issueDate = new Date().toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' });
    
    doc.moveDown(3.5);
    const currentY = doc.y;
    
    // Left: Date Block
    doc.fontSize(12).font('Helvetica-Bold').fillColor('#1A1F2E').text(`Date of Issuance:`, 80, currentY);
    doc.fontSize(12).font('Helvetica').fillColor('#4A5568').text(issueDate, 80, currentY + 18);
    
    // Right: Issuer Authority Block
    doc.fontSize(12).font('Helvetica-Bold').fillColor('#1A1F2E').text('Issued & Verified by:', doc.page.width - 320, currentY, { align: 'right', width: 240 });
    doc.fontSize(11).font('Helvetica').fillColor('#8892A4').text('nulltribe. Application Security Portal', doc.page.width - 320, currentY + 18, { align: 'right', width: 240 });

    doc.end();
});

// Start Hook
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`[nulltribe API] Orchestrator online at port ${PORT}`));