const express = require('express');
const { MongoClient, ObjectId } = require('mongodb');
const cors = require('cors');
const path = require('path');

const app = express();
app.use(express.json());
app.use(cors());
app.use('/images', express.static(path.join(__dirname, 'images')));

// YOUR MONGODB CONNECTION STRING
const uri = "mongodb+srv://farmadmin:FARMTRUST2026@cluster0.ftuczeu.mongodb.net/?retryWrites=true&w=majority";
const client = new MongoClient(uri);
let db;

client.connect().then(() => {
    db = client.db('farmtrust');
    console.log("Connected to MongoDB");
    
    // Seed packages if empty
    db.collection('packages').countDocuments().then(count => {
        if (count === 0) {
            db.collection('packages').insertMany([
                { name: 'Chick Package', invest_amount: 50, return_amount: 200, duration: '1 day 5 hours', days: 1.2, image_url: '/images/chick.jpg' },
                { name: 'Rabbit Package', invest_amount: 70, return_amount: 310, duration: '1 day 8 hours', days: 1.3, image_url: '/images/rabbit.jpg' },
                { name: 'Goat Kid Package', invest_amount: 100, return_amount: 450, duration: '2 days 2 hours', days: 2.1, image_url: '/images/goat.jpg' },
                { name: 'Piglet Package', invest_amount: 200, return_amount: 550, duration: '2 days 5 hours', days: 2.2, image_url: '/images/piglet.jpg' },
                { name: 'Calf Package', invest_amount: 300, return_amount: 730, duration: '2 days 9 hours', days: 2.4, image_url: '/images/calf.jpg' },
                { name: 'Sheep Package', invest_amount: 500, return_amount: 4500, duration: '3 days 5 hours', days: 3.2, image_url: '/images/sheep.jpg' },
                { name: 'Dairy Cow Package', invest_amount: 3000, return_amount: 28000, duration: '4 days 16 hours', days: 4.6, image_url: '/images/cow.jpg' }
            ]);
        }
    });
}).catch(err => console.error(err));

// --- AUTH API ---
app.post('/api/signup', async (req, res) => {
    const { username, email, password, phone } = req.body;
    try {
        const existing = await db.collection('users').findOne({ email });
        if (existing) return res.status(400).json({ error: "Email already exists" });
        
        const result = await db.collection('users').insertOne({ username, email, password, phone, balance: 0 });
        res.json({ message: "User created successfully", userId: result.insertedId });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

app.post('/api/login', async (req, res) => {
    const { email, password } = req.body;
    const user = await db.collection('users').findOne({ email, password });
    if (!user) return res.status(401).json({ error: "Invalid email or password" });
    res.json({ message: "Login successful", user: { id: user._id, username: user.username, balance: user.balance } });
});

app.get('/api/user/:id', async (req, res) => {
    try {
        const user = await db.collection('users').findOne({ _id: new ObjectId(req.params.id) });
        if (!user) return res.status(404).json({ error: "User not found" });
        res.json({ username: user.username, balance: user.balance });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// --- ADMIN API ---
app.get('/api/users', async (req, res) => {
    const users = await db.collection('users').find({}).toArray();
    res.json(users);
});

app.post('/api/admin/search-user', async (req, res) => {
    const { query } = req.body;
    const regex = new RegExp(query, 'i');
    const users = await db.collection('users').find({
        $or: [{ username: regex }, { email: regex }, { phone: regex }]
    }).toArray();
    res.json(users);
});

app.post('/api/admin/adjust-balance', async (req, res) => {
    const { userId, amount, action } = req.body;
    const incrementValue = action === 'add' ? Number(amount) : -Number(amount);
    await db.collection('users').updateOne(
        { _id: new ObjectId(userId) },
        { $inc: { balance: incrementValue } }
    );
    res.json({ message: "Balance updated successfully" });
});

app.get('/api/transactions/pending', async (req, res) => {
    const txns = await db.collection('transactions').aggregate([
        { $match: { status: 'pending' } },
        { $lookup: { from: 'users', localField: 'user_id', foreignField: '_id', as: 'user' } },
        { $unwind: '$user' },
        { $project: { _id: 1, amount: 1, type: 1, username: '$user.username' } }
    ]).toArray();
    res.json(txns);
});

app.post('/api/transactions/action', async (req, res) => {
    const { transactionId, action } = req.body;
    const txn = await db.collection('transactions').findOne({ _id: new ObjectId(transactionId) });
    
    if (action === 'reject') {
        await db.collection('transactions').updateOne({ _id: new ObjectId(transactionId) }, { $set: { status: 'rejected' } });
        return res.json({ message: "Rejected" });
    }

    await db.collection('transactions').updateOne({ _id: new ObjectId(transactionId) }, { $set: { status: 'approved' } });
    
    if (txn.type === 'deposit') {
        await db.collection('users').updateOne({ _id: txn.user_id }, { $inc: { balance: txn.amount } });
    }
    res.json({ message: "Approved" });
});

// --- USER ACTIONS API ---
app.get('/api/packages', async (req, res) => {
    const packages = await db.collection('packages').find({}).sort({ invest_amount: 1 }).toArray();
    res.json(packages);
});

app.post('/api/deposit', async (req, res) => {
    const { userId, amount } = req.body;
    await db.collection('transactions').insertOne({ user_id: new ObjectId(userId), amount, type: 'deposit', status: 'pending' });
    res.json({ message: "Deposit requested successfully." });
});

// NEW: Get User Transaction History
app.get('/api/transactions/:userId', async (req, res) => {
    try {
        const txns = await db.collection('transactions')
            .find({ user_id: new ObjectId(req.params.userId) })
            .sort({ _id: -1 }) // Newest first
            .toArray();
        res.json(txns);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

app.post('/api/invest', async (req, res) => {
    const { userId, amount, returnAmount, packageName, days } = req.body;
    const user = await db.collection('users').findOne({ _id: new ObjectId(userId) });
    
    if (user.balance < amount) return res.status(400).json({ error: "Insufficient balance" });

    const startDate = new Date();
    let endDate = new Date();
    endDate.setDate(startDate.getDate() + Math.ceil(days || 1));

    await db.collection('users').updateOne({ _id: user._id }, { $inc: { balance: -amount } });
    await db.collection('investments').insertOne({
        user_id: user._id, package_name: packageName, invest_amount: amount, return_amount: returnAmount,
        start_date: startDate, end_date: endDate
    });

    res.json({ message: "Investment successful!" });
});

app.get('/api/investments/:userId', async (req, res) => {
    const invs = await db.collection('investments').aggregate([
        { $match: { user_id: new ObjectId(req.params.userId) } },
        { $lookup: { from: 'packages', localField: 'package_name', foreignField: 'name', as: 'pkg' } },
        { $unwind: '$pkg' },
        { $project: { _id: 1, package_name: 1, invest_amount: 1, return_amount: 1, start_date: 1, end_date: 1, image_url: '$pkg.image_url' } }
    ]).toArray();
    res.json(invs);
});

app.post('/api/withdraw', async (req, res) => {
    const { userId, amount } = req.body;
    const user = await db.collection('users').findOne({ _id: new ObjectId(userId) });
    if (user.balance < amount) return res.status(400).json({ error: "Insufficient balance" });

    await db.collection('users').updateOne({ _id: user._id }, { $inc: { balance: -amount } });
    await db.collection('transactions').insertOne({ user_id: user._id, amount, type: 'withdrawal', status: 'pending' });
    res.json({ message: "Withdrawal requested" });
});

// --- SERVE HTML ---
app.get('/', (req, res) => { res.sendFile(path.join(__dirname, 'admin.html')); });
app.get('/app', (req, res) => { res.sendFile(path.join(__dirname, 'login.html')); });
app.get('/dashboard', (req, res) => { res.sendFile(path.join(__dirname, 'user.html')); });
app.get('/wallet', (req, res) => { res.sendFile(path.join(__dirname, 'wallet.html')); });
app.get('/profile', (req, res) => { res.sendFile(path.join(__dirname, 'profile.html')); });

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
});