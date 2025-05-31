const express = require('express');
const bodyParser = require('body-parser');
const jwt = require('jsonwebtoken');
const bcrypt = require('bcryptjs');
const fs = require('fs').promises;
const path = require('path');

const app = express();
const PORT = process.env.PORT || 4000;
const JWT_SECRET = 'your-secret-key'; // In production, use environment variable

app.use(bodyParser.json());
app.use(express.static('.'));

// Middleware to verify JWT token
const authenticateToken = (req, res, next) => {
    const authHeader = req.headers['authorization'];
    const token = authHeader && authHeader.split(' ')[1];

    if (!token) {
        return res.status(401).json({ error: 'Token topilmadi' });
    }

    jwt.verify(token, JWT_SECRET, (err, user) => {
        if (err) {
            return res.status(403).json({ error: 'Noto\'g\'ri token' });
        }
        req.user = user;
        next();
    });
};

// Read users data
async function readUsers() {
    try {
        const data = await fs.readFile('users.json', 'utf8');
        return JSON.parse(data);
    } catch (error) {
        return { users: [], registeredUsers: [] };
    }
}

// Write users data
async function writeUsers(data) {
    await fs.writeFile('users.json', JSON.stringify(data, null, 2));
}

// Register endpoint
app.post('/register', async (req, res) => {
    try {
        console.log('Registration request received:', req.body);
        const { fullname, email, phone, password } = req.body;

        // Validate required fields
        if (!fullname || !email || !phone || !password) {
            console.log('Missing required fields:', { fullname, email, phone, password: !!password });
            return res.status(400).json({ 
                error: 'Barcha maydonlar to\'ldirilishi shart',
                fields: { fullname, email, phone, hasPassword: !!password }
            });
        }

        const data = await readUsers();
        console.log('Current users:', data.registeredUsers.length);

        // Check if user already exists
        if (data.registeredUsers.some(user => user.email === email)) {
            console.log('User already exists with email:', email);
            return res.status(400).json({ error: 'Bu email allaqachon ro\'yxatdan o\'tgan' });
        }

        // Hash password
        const hashedPassword = await bcrypt.hash(password, 10);
        console.log('Password hashed successfully');

        // Create new user
        const newUser = {
            id: data.registeredUsers.length + 1,
            fullname,
            email,
            phone,
            password: hashedPassword,
            registeredAt: new Date().toISOString(),
            status: 'active',
            role: 'user'
        };

        console.log('New user object created:', { ...newUser, password: '[HIDDEN]' });

        data.registeredUsers.push(newUser);
        await writeUsers(data);
        console.log('User saved successfully');

        res.status(201).json({ message: 'Muvaffaqiyatli ro\'yxatdan o\'tdingiz' });
    } catch (error) {
        console.error('Registration error:', error);
        res.status(500).json({ 
            error: 'Serverda xatolik yuz berdi', 
            details: error.message 
        });
    }
});

// Login endpoint
app.post('/login', async (req, res) => {
    try {
        const { email, password } = req.body;
        const data = await readUsers();

        const user = data.registeredUsers.find(u => u.email === email);
        if (!user) {
            return res.status(400).json({ error: 'Email yoki parol noto\'g\'ri' });
        }

        const validPassword = await bcrypt.compare(password, user.password);
        if (!validPassword) {
            return res.status(400).json({ error: 'Email yoki parol noto\'g\'ri' });
        }

        // Create token
        const token = jwt.sign({ id: user.id, role: user.role || 'user' }, JWT_SECRET);

        // Remove password from user object
        const { password: _, ...userWithoutPassword } = user;

        res.json({
            token,
            user: {
                ...userWithoutPassword,
                role: user.role || 'user'
            }
        });
    } catch (error) {
        console.error('Error:', error);
        res.status(500).json({ error: 'Serverda xatolik yuz berdi' });
    }
});

// Get users (admin only)
app.get('/api/users', authenticateToken, async (req, res) => {
    try {
        const data = await readUsers();
        const users = data.registeredUsers.map(({ password, ...user }) => user);
        res.json(users);
    } catch (error) {
        console.error('Error:', error);
        res.status(500).json({ error: 'Serverda xatolik yuz berdi' });
    }
});

// Update profile
app.put('/api/profile', authenticateToken, async (req, res) => {
    try {
        const { fullname, email, phone } = req.body;
        const data = await readUsers();

        const userIndex = data.registeredUsers.findIndex(u => u.id === req.user.id);
        if (userIndex === -1) {
            return res.status(404).json({ error: 'Foydalanuvchi topilmadi' });
        }

        // Update user data
        data.registeredUsers[userIndex] = {
            ...data.registeredUsers[userIndex],
            fullname,
            email,
            phone
        };

        await writeUsers(data);

        // Remove password from response
        const { password, ...updatedUser } = data.registeredUsers[userIndex];
        res.json(updatedUser);
    } catch (error) {
        console.error('Error:', error);
        res.status(500).json({ error: 'Serverda xatolik yuz berdi' });
    }
});

// Delete user (admin only)
app.delete('/api/users/:id', authenticateToken, async (req, res) => {
    try {
        const userId = parseInt(req.params.id);
        const data = await readUsers();

        const userIndex = data.registeredUsers.findIndex(u => u.id === userId);
        if (userIndex === -1) {
            return res.status(404).json({ error: 'Foydalanuvchi topilmadi' });
        }

        data.registeredUsers.splice(userIndex, 1);
        await writeUsers(data);

        res.json({ message: 'Foydalanuvchi o\'chirildi' });
    } catch (error) {
        console.error('Error:', error);
        res.status(500).json({ error: 'Serverda xatolik yuz berdi' });
    }
});

// Get services
app.get('/api/services', async (req, res) => {
    try {
        const data = await fs.readFile('services.json', 'utf8');
        res.json(JSON.parse(data));
    } catch (error) {
        console.error('Error:', error);
        res.status(500).json({ error: 'Serverda xatolik yuz berdi' });
    }
});

// Create order
app.post('/api/orders', authenticateToken, async (req, res) => {
    try {
        const { serviceId, problem } = req.body;
        const userId = req.user.id;

        // Validate required fields
        if (!serviceId || !problem) {
            return res.status(400).json({ error: 'Barcha maydonlar to\'ldirilishi shart' });
        }

        // Get service details
        const servicesData = await fs.readFile('services.json', 'utf8');
        const services = JSON.parse(servicesData).services;
        const service = services.find(s => s.id === parseInt(serviceId));

        if (!service) {
            return res.status(404).json({ error: 'Xizmat topilmadi' });
        }

        // Read current orders
        const ordersData = await fs.readFile('orders.json', 'utf8');
        const orders = JSON.parse(ordersData);

        // Create new order
        const newOrder = {
            id: orders.orders.length + 1,
            userId,
            serviceId: parseInt(serviceId),
            serviceName: service.name,
            problem,
            status: 'pending',
            createdAt: new Date().toISOString(),
            price: null,
            estimatedTime: null,
            startTime: null
        };

        orders.orders.push(newOrder);
        await fs.writeFile('orders.json', JSON.stringify(orders, null, 2));

        res.status(201).json(newOrder);
    } catch (error) {
        console.error('Error:', error);
        res.status(500).json({ error: 'Serverda xatolik yuz berdi' });
    }
});

// Get user's orders
app.get('/api/orders/my', authenticateToken, async (req, res) => {
    try {
        const ordersData = await fs.readFile('orders.json', 'utf8');
        const orders = JSON.parse(ordersData);
        
        const userOrders = orders.orders.filter(order => order.userId === req.user.id);
        res.json(userOrders);
    } catch (error) {
        console.error('Error:', error);
        res.status(500).json({ error: 'Serverda xatolik yuz berdi' });
    }
});

// Get all orders (admin only)
app.get('/api/orders', authenticateToken, async (req, res) => {
    try {
        const ordersData = await fs.readFile('orders.json', 'utf8');
        const orders = JSON.parse(ordersData);
        
        // Get user details for each order
        const usersData = await readUsers();
        const ordersWithUserDetails = orders.orders.map(order => {
            const user = usersData.registeredUsers.find(u => u.id === order.userId);
            return {
                ...order,
                user: user ? {
                    fullname: user.fullname,
                    email: user.email,
                    phone: user.phone
                } : null
            };
        });

        res.json(ordersWithUserDetails);
    } catch (error) {
        console.error('Error:', error);
        res.status(500).json({ error: 'Serverda xatolik yuz berdi' });
    }
});

// Update order status
app.put('/api/orders/:id', authenticateToken, async (req, res) => {
    try {
        const orderId = parseInt(req.params.id);
        const { status, price, estimatedTime, comments } = req.body;

        const ordersData = await fs.readFile('orders.json', 'utf8');
        const orders = JSON.parse(ordersData);

        const orderIndex = orders.orders.findIndex(o => o.id === orderId);
        if (orderIndex === -1) {
            return res.status(404).json({ error: 'Buyurtma topilmadi' });
        }

        // Update order
        orders.orders[orderIndex] = {
            ...orders.orders[orderIndex],
            status,
            price: price || orders.orders[orderIndex].price,
            estimatedTime: estimatedTime || orders.orders[orderIndex].estimatedTime,
            comments: comments || orders.orders[orderIndex].comments,
            startTime: status === 'in_progress' ? new Date().toISOString() : orders.orders[orderIndex].startTime,
            completedTime: status === 'completed' ? new Date().toISOString() : orders.orders[orderIndex].completedTime,
            cancelledTime: status === 'cancelled' ? new Date().toISOString() : orders.orders[orderIndex].cancelledTime
        };

        await fs.writeFile('orders.json', JSON.stringify(orders, null, 2));

        // Get user details
        const usersData = await readUsers();
        const user = usersData.registeredUsers.find(u => u.id === orders.orders[orderIndex].userId);
        
        const orderWithUser = {
            ...orders.orders[orderIndex],
            user: user ? {
                fullname: user.fullname,
                email: user.email,
                phone: user.phone
            } : null
        };

        res.json(orderWithUser);
    } catch (error) {
        console.error('Error:', error);
        res.status(500).json({ error: 'Serverda xatolik yuz berdi' });
    }
});

// Create user (admin only)
app.post('/api/users', authenticateToken, async (req, res) => {
    try {
        console.log('Admin creating new user:', { ...req.body, password: '[HIDDEN]' });
        const { fullname, email, phone, password, status } = req.body;

        // Validate required fields
        if (!fullname || !email || !phone || !password) {
            return res.status(400).json({ error: 'Barcha maydonlar to\'ldirilishi shart' });
        }

        const data = await readUsers();

        // Check if user already exists
        if (data.registeredUsers.some(user => user.email === email)) {
            return res.status(400).json({ error: 'Bu email allaqachon ro\'yxatdan o\'tgan' });
        }

        // Hash password
        const hashedPassword = await bcrypt.hash(password, 10);

        // Create new user
        const newUser = {
            id: data.registeredUsers.length + 1,
            fullname,
            email,
            phone,
            password: hashedPassword,
            registeredAt: new Date().toISOString(),
            status: status || 'active',
            role: 'user'
        };

        data.registeredUsers.push(newUser);
        await writeUsers(data);

        // Remove password from response
        const { password: _, ...userWithoutPassword } = newUser;
        res.status(201).json(userWithoutPassword);
    } catch (error) {
        console.error('Error creating user:', error);
        res.status(500).json({ error: 'Serverda xatolik yuz berdi' });
    }
});

// Update user (admin only)
app.put('/api/users/:id', authenticateToken, async (req, res) => {
    try {
        const userId = parseInt(req.params.id);
        const { fullname, email, phone, status, role } = req.body;
        const data = await readUsers();

        const userIndex = data.registeredUsers.findIndex(u => u.id === userId);
        if (userIndex === -1) {
            return res.status(404).json({ error: 'Foydalanuvchi topilmadi' });
        }

        // Update user data
        data.registeredUsers[userIndex] = {
            ...data.registeredUsers[userIndex],
            fullname: fullname || data.registeredUsers[userIndex].fullname,
            email: email || data.registeredUsers[userIndex].email,
            phone: phone || data.registeredUsers[userIndex].phone,
            status: status || data.registeredUsers[userIndex].status,
            role: role || data.registeredUsers[userIndex].role
        };

        await writeUsers(data);

        // Remove password from response
        const { password: _, ...updatedUser } = data.registeredUsers[userIndex];
        res.json(updatedUser);
    } catch (error) {
        console.error('Error updating user:', error);
        res.status(500).json({ error: 'Serverda xatolik yuz berdi' });
    }
});

app.listen(PORT, () => {
    console.log(`Server ${PORT} portda ishga tushdi`);
}); 