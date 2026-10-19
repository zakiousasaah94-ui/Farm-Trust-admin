const express = require('express');
const sqlite3 = require('sqlite3').verbose();
const cors = require('cors');
const path = require('path');

const app = express();
app.use(express.json());
app.use(cors());
app.use('/images', express.static(path.join(__dirname, 'images')));

const db = new sqlite3.Database('./database.db');

db.serialize(() => {
    db.run(`CREATE TABLE IF NOT EXISTS users (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        username TEXT,
        email TEXT UNIQUE,
        password TEXT,
        phone TEXT,
        balance REAL DEFAULT 0
    )`);

    db.run(`CREATE TABLE IF NOT EXISTS transactions (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id INTEGER,
        amount REAL,
        type TEXT,
        status TEXT DEFAULT 'pending',
        FOREIGN KEY(user_id) REFERENCES users(id)
    )`);

    db.run(`CREATE TABLE IF NOT EXISTS investments (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id INTEGER,
        package_name TEXT,
        invest_amount REAL,
        return_amount REAL,
        start_date DATETIME,
        end_date DATETIME,
        status TEXT DEFAULT 'active'
    )`);

    db.run(`CREATE TABLE IF NOT EXISTS packages (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT,
        invest_amount REAL,
        return_amount REAL,
        duration TEXT,
        days INTEGER,
        image_url TEXT
    )`);

    db.get("SELECT count(*) as count FROM packages", (err, row) => {
        if (row.count === 0) {
            const insertPkg = `INSERT INTO packages (name, invest_amount, return_amount, duration, days, image_url) VALUES (?, ?, ?, ?, ?, ?)`;
            db.run(insertPkg, ['Chick Package', 50, 200, '1 day 5 hours', 1.2, '/images/chick.jpg']);
            db.run(insertPkg, ['Rabbit Package', 70, 310, '1 day 8 hours', 1.3, '/images/rabbit.jpg']);
            db.run(insertPkg, ['Goat Kid Package', 100, 450, '2 days 2 hours', 2.1, '/images/goat.jpg']);
            db.run(insertPkg, ['Piglet Package', 200, 550, '2 days 5 hours', 2.2, '/images/piglet.jpg']);
            db.run(insertPkg, ['Calf Package', 300, 730, '2 days 9 hours', 2.4, '/images/calf.jpg']);
            db.run(insertPkg, ['Sheep Package', 500, 4500, '3 days 5 hours', 3.2, '/images/sheep.jpg']);
            db.run(insertPkg, ['Dairy Cow Package', 3000, 28000, '4 days 16 hours', 4.6, '/images/cow.jpg']);
        }
    });
});

// --- AUTH API ---
app.post('/api/signup', (req, res) => {
    const { username, email, password, phone } = req.body;
    db.run(`INSERT INTO users (username, email, password, phone) VALUES (?, ?, ?, ?)`, [username, email, password, phone], function(err) {
        if (err) return res.status(400).json({ error: "Email already exists" });
        res.json({ message: "User created successfully", userId: this.lastID });
    });
});

app.post('/api/login', (req, res) => {
    const { email, password } = req.body;
    db.get(`SELECT * FROM users WHERE email = ? AND password = ?`, [email, password], (err, user) => {
        if (err || !user) return res.status(401).json({ error: "Invalid email or password" });
        res.json({ message: "Login successful", user: { id: user.id, username: user.username, balance: user.balance } });
    });
});

app.get('/api/user/:id', (req, res) => {
    db.get(`SELECT username, balance FROM users WHERE id = ?`, [req.params.id], (err, user) => {
        if (err || !user) return res.status(404).json({ error: "User not found" });
        res.json(user);
    });
});

// --- ADMIN API ---
app.get('/api/users', (req, res) => {
    db.all("SELECT * FROM users", [], (err, rows) => {
        if (err) return res.status(500).json({ error: err.message });
        res.json(rows);
    });
});

app.post('/api/admin/search-user', (req, res) => {
    const { query } = req.body;
    const searchTerm = `%${query}%`;
    const sql = `SELECT * FROM users WHERE username LIKE ? OR email LIKE ? OR phone LIKE ?`;
    db.all(sql, [searchTerm, searchTerm, searchTerm], (err, rows) => {
        if (err) return res.status(500).json({ error: err.message });
        res.json(rows);
    });
});

app.post('/api/admin/adjust-balance', (req, res) => {
    const { userId, amount, action } = req.body;
    const operator = action === 'add' ? '+' : '-';
    db.run(`UPDATE users SET balance = balance ${operator} ? WHERE id = ?`, [amount, userId], function(err) {
        if (err) return res.status(500).json({ error: err.message });
        res.json({ message: "Balance updated successfully" });
    });
});

app.get('/api/transactions/pending', (req, res) => {
    const sql = `SELECT t.id, t.amount, t.type, u.username FROM transactions t JOIN users u ON t.user_id = u.id WHERE t.status = 'pending'`;
    db.all(sql, [], (err, rows) => {
        if (err) return res.status(500).json({ error: err.message });
        res.json(rows);
    });
});

app.post('/api/transactions/action', (req, res) => {
    const { transactionId, action } = req.body;
    if (action === 'reject') {
        db.run(`UPDATE transactions SET status = 'rejected' WHERE id = ?`, [transactionId], (err) => {
            if (err) return res.status(500).json({ error: err.message });
            res.json({ message: "Transaction Rejected" });
        });
        return;
    }
    
    db.get(`SELECT user_id, amount, type FROM transactions WHERE id = ?`, [transactionId], (err, txn) => {
        if (err || !txn) return res.status(404).json({ error: "Transaction not found" });
        
        db.run(`UPDATE transactions SET status = 'approved' WHERE id = ?`, [transactionId]);
        
        if (txn.type === 'deposit') {
            db.run(`UPDATE users SET balance = balance + ? WHERE id = ?`, [txn.amount, txn.user_id], (err) => {
                if (err) return res.status(500).json({ error: err.message });
                res.json({ message: "Deposit Approved" });
            });
        } else if (txn.type === 'withdrawal') {
            res.json({ message: "Withdrawal Approved" });
        }
    });
});

// --- USER ACTIONS API ---
app.get('/api/packages', (req, res) => {
    db.all("SELECT * FROM packages ORDER BY invest_amount ASC", [], (err, rows) => {
        if (err) return res.status(500).json({ error: err.message });
        res.json(rows);
    });
});

app.post('/api/deposit', (req, res) => {
    const { userId, amount } = req.body;
    db.run(`INSERT INTO transactions (user_id, amount, type, status) VALUES (?, ?, 'deposit', 'pending')`, [userId, amount], (err) => {
        if (err) return res.status(500).json({ error: err.message });
        res.json({ message: "Deposit requested successfully." });
    });
});

app.post('/api/invest', (req, res) => {
    const { userId, amount, returnAmount, packageName, days } = req.body;
    db.get(`SELECT balance FROM users WHERE id = ?`, [userId], (err, user) => {
        if (err || !user) return res.status(404).json({ error: "User not found" });
        if (user.balance < amount) return res.status(400).json({ error: "Insufficient balance" });

        const startDate = new Date();
        let endDate = new Date();
        endDate.setDate(startDate.getDate() + Math.ceil(days || 1)); 

        db.run(`UPDATE users SET balance = balance - ? WHERE id = ?`, [amount, userId], (err) => {
            if (err) return res.status(500).json({ error: err.message });
            
            db.run(`INSERT INTO investments (user_id, package_name, invest_amount, return_amount, start_date, end_date) VALUES (?, ?, ?, ?, ?, ?)`, 
            [userId, packageName, amount, returnAmount, startDate.toISOString(), endDate.toISOString()], (err) => {
                if (err) return res.status(500).json({ error: err.message });
                res.json({ message: "Investment successful!" });
            });
        });
    });
});

app.get('/api/investments/:userId', (req, res) => {
    const sql = `
        SELECT i.*, p.image_url 
        FROM investments i 
        JOIN packages p ON i.package_name = p.name 
        WHERE i.user_id = ?
        ORDER BY i.id DESC
    `;
    db.all(sql, [req.params.userId], (err, rows) => {
        if (err) return res.status(500).json({ error: err.message });
        res.json(rows);
    });
});

app.post('/api/withdraw', (req, res) => {
    const { userId, amount, momoNumber } = req.body;
    db.get(`SELECT balance FROM users WHERE id = ?`, [userId], (err, user) => {
        if (err || !user) return res.status(404).json({ error: "User not found" });
        if (user.balance < amount) return res.status(400).json({ error: "Insufficient balance" });

        db.run(`UPDATE users SET balance = balance - ? WHERE id = ?`, [amount, userId], (err) => {
            if (err) return res.status(500).json({ error: err.message });
            db.run(`INSERT INTO transactions (user_id, amount, type, status) VALUES (?, ?, 'withdrawal', 'pending')`, [userId, amount], (err) => {
                if (err) return res.status(500).json({ error: err.message });
                res.json({ message: "Withdrawal requested" });
            });
        });
    });
});

// --- SERVE HTML ---
app.get('/', (req, res) => { res.sendFile(path.join(__dirname, 'admin.html')); });
app.get('/app', (req, res) => { res.sendFile(path.join(__dirname, 'login.html')); });
app.get('/dashboard', (req, res) => { res.sendFile(path.join(__dirname, 'user.html')); });
app.get('/wallet', (req, res) => { res.sendFile(path.join(__dirname, 'wallet.html')); });
app.get('/profile', (req, res) => { res.sendFile(path.join(__dirname, 'profile.html')); });

app.listen(3000, () => {
    console.log('Server running on http://localhost:3000');
});