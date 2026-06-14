const express = require('express');
const mysql = require('mysql2');
const cors = require('cors');
const path = require('path');

const app = express();
app.use(cors());
app.use(express.json());

// ============================================
// 1. 静态网页托管（解决 Cannot GET /）
// ============================================
app.use(express.static(__dirname));

app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'index.html'));
});

// ============================================
// 2. 内存数据库降级数据
// ============================================
let useMock = false;

const mockData = {
    materials: [
        { material_id: 1, material_name: '东北大米稻种', category: '种子', spec: '50kg/袋', unit: '包' },
        { material_id: 2, material_name: '强效复合肥', category: '化肥', spec: '50kg/袋', unit: '包' },
        { material_id: 3, material_name: '测试种子', category: '种子', spec: '10kg/袋', unit: '包' }
    ],
    stock: [
        { warehouse_id: 1, material_id: 1, quantity: 200 },
        { warehouse_id: 2, material_id: 2, quantity: 80 },
        { warehouse_id: 1, material_id: 3, quantity: 40 }
    ],
    warehouse: [
        { warehouse_id: 1, warehouse_name: '一号种子库' },
        { warehouse_id: 2, warehouse_name: '二号化肥库' }
    ],
    supplier: [
        { supplier_id: 1, supplier_name: '绿野农资有限公司' },
        { supplier_id: 2, supplier_name: '金盾化工集团' }
    ],
    purchase_order: [
        { po_id: 26, supplier_id: 1, warehouse_id: 1, total_amount: 5000.00, date: '2025/12/22' },
        { po_id: 25, supplier_id: 1, warehouse_id: 1, total_amount: 200.00, date: '2025/12/22' },
        { po_id: 24, supplier_id: 1, warehouse_id: 2, total_amount: 1000.00, date: '2025/12/22' },
        { po_id: 23, supplier_id: 1, warehouse_id: 2, total_amount: 500.00, date: '2025/12/22' }
    ],
    purchase_order_detail: [
        { po_id: 26, material_id: 1, quantity: 50, price: 100 },
        { po_id: 25, material_id: 3, quantity: 10, price: 20 },
        { po_id: 24, material_id: 2, quantity: 20, price: 50 },
        { po_id: 23, material_id: 2, quantity: 10, price: 50 }
    ],
    outbound_record: [
        { out_id: 5, warehouse_id: 1, purpose: '实验消耗', date: '2025/12/22' },
        { out_id: 4, warehouse_id: 1, purpose: '实验消耗', date: '2025/12/22' },
        { out_id: 3, warehouse_id: 2, purpose: '春耕', date: '2025/12/22' }
    ],
    outbound_record_detail: [
        { out_id: 5, material_id: 1, quantity: 5 },
        { out_id: 4, material_id: 3, quantity: 10 },
        { out_id: 3, material_id: 2, quantity: 15 }
    ]
};

// ============================================
// 3. 数据库连接与自动降级机制
// ============================================
const db = mysql.createConnection({
    host: 'localhost',
    user: 'root',
    password: '123456',
    database: 'agri_inventory_system'
});

db.connect(err => {
    if (err) {
        console.warn('⚠️ 检测到云环境，MySQL连不上，系统已自动切换至【内存数据库】模式！');
        useMock = true;
    } else {
        console.log('✅ MySQL 数据库连接成功！');
    }
});

// ============================================
// 4. 核心业务接口
// ============================================
app.get('/api/stats', (req, res) => {
    if (useMock) {
        const mat = mockData.materials.length;
        const stock = mockData.stock.reduce((acc, c) => acc + c.quantity, 0);
        const alert = mockData.stock.filter(s => s.quantity < 20).length;
        const po = mockData.purchase_order.length;
        return res.json({ mat, stock, alert, po });
    }
    const stats = {};
    db.query('SELECT COUNT(*) c FROM material', (e, r) => { stats.mat = r[0].c;
        db.query('SELECT SUM(quantity) c FROM stock', (e, r) => { stats.stock = r[0].c || 0;
            db.query('SELECT COUNT(*) c FROM stock WHERE quantity < 20', (e, r) => { stats.alert = r[0].c;
                db.query('SELECT COUNT(*) c FROM purchase_order', (e, r) => { stats.po = r[0].c;
                    res.json(stats);
                });
            });
        });
    });
});

app.get('/api/charts', (req, res) => {
    if (useMock) {
        const pieMap = {};
        mockData.materials.forEach(m => {
            const s = mockData.stock.find(st => st.material_id === m.material_id);
            pieMap[m.category] = (pieMap[m.category] || 0) + (s ? s.quantity : 0);
        });
        const pie = Object.keys(pieMap).map(k => ({ name: k, value: pieMap[k] }));
        const bar = mockData.warehouse.map(w => {
            const sQty = mockData.stock.filter(st => st.warehouse_id === w.warehouse_id).reduce((acc, curr) => acc + curr.quantity, 0);
            return { name: w.warehouse_name, value: sQty };
        });
        return res.json({ pie, bar });
    }
    db.query(`SELECT m.category as name, SUM(IFNULL(s.quantity,0)) as value FROM material m LEFT JOIN stock s ON m.material_id=s.material_id GROUP BY m.category`, (e, pie) => {
        db.query(`SELECT w.warehouse_name as name, SUM(IFNULL(s.quantity,0)) as value FROM warehouse w LEFT JOIN stock s ON w.warehouse_id=s.warehouse_id GROUP BY w.warehouse_name`, (e, bar) => { res.json({pie, bar}); });
    });
});

app.get('/api/materials', (req, res) => {
    if (useMock) {
        const rows = mockData.materials.map(m => {
            const sQty = mockData.stock.filter(st => st.material_id === m.material_id).reduce((acc, curr) => acc + curr.quantity, 0);
            return { material_id: m.material_id, material_name: m.material_name, category: m.category, spec: m.spec, unit: m.unit || '包', stock: sQty };
        });
        return res.json(rows);
    }
    db.query(`SELECT m.material_id, m.material_name, m.category, m.spec, m.unit, SUM(IFNULL(s.quantity, 0)) as stock FROM material m LEFT JOIN stock s ON m.material_id = s.material_id GROUP BY m.material_id`, (err, rows) => res.json(rows));
});

app.post('/api/materials', (req, res) => {
    const { name, category, spec, stock } = req.body;
    const qty = parseInt(stock) || 0;
    if (useMock) {
        const existing = mockData.materials.find(m => m.material_name === name);
        if (existing) {
            const s = mockData.stock.find(st => st.material_id === existing.material_id && st.warehouse_id === 1);
            if (s) s.quantity += qty;
            else mockData.stock.push({ warehouse_id: 1, material_id: existing.material_id, quantity: qty });
            return res.json({ msg: `物资已存在，库存已累加 ${qty}` });
        } else {
            const newId = mockData.materials.length > 0 ? Math.max(...mockData.materials.map(m => m.material_id)) + 1 : 1;
            mockData.materials.push({ material_id: newId, material_name: name, category, spec, unit: '包' });
            mockData.stock.push({ warehouse_id: 1, material_id: newId, quantity: qty });
            return res.json({ msg: '新物资添加成功' });
        }
    }
    db.query('SELECT material_id FROM material WHERE material_name = ?', [name], (err, rows) => {
        if(rows.length > 0) {
            db.query('INSERT INTO stock (warehouse_id, material_id, quantity) VALUES (1, ?, ?) ON DUPLICATE KEY UPDATE quantity = quantity + ?', [rows[0].material_id, qty, qty], () => { res.json({ msg: `物资已存在，库存已累加 ${qty}` }); });
        } else {
            db.query('INSERT INTO material (material_name, category, spec) VALUES (?,?,?)', [name, category, spec], (err, r) => {
                db.query('INSERT INTO stock (warehouse_id, material_id, quantity) VALUES (1, ?, ?)', [r.insertId, qty], () => { res.json({ msg: '新物资添加成功' }); });
            });
        }
    });
});

app.put('/api/materials', (req, res) => {
    const { id, name, category, spec, stock } = req.body;
    const targetId = parseInt(id);
    if (useMock) {
        const m = mockData.materials.find(item => item.material_id === targetId);
        if (m) { m.material_name = name; m.category = category; m.spec = spec; }
        mockData.stock = mockData.stock.filter(st => st.material_id !== targetId);
        mockData.stock.push({ warehouse_id: 1, material_id: targetId, quantity: parseInt(stock) || 0 });
        return res.json({ msg: '修改成功' });
    }
    db.query('UPDATE material SET material_name=?, category=?, spec=? WHERE material_id=?', [name, category, spec, id], () => {
        db.query('DELETE FROM stock WHERE material_id = ?', [id], () => {
            db.query('INSERT INTO stock (warehouse_id, material_id, quantity) VALUES (1, ?, ?)', [id, stock], () => { res.json({ msg: '修改成功' }); });
        });
    });
});

app.delete('/api/materials/:id', (req, res) => {
    const id = parseInt(req.params.id);
    if (useMock) {
        mockData.purchase_order_detail = mockData.purchase_order_detail.filter(item => item.material_id !== id);
        mockData.outbound_record_detail = mockData.outbound_record_detail.filter(item => item.material_id !== id);
        mockData.stock = mockData.stock.filter(item => item.material_id !== id);
        mockData.materials = mockData.materials.filter(item => item.material_id !== id);
        return res.json({ msg: '删除成功' });
    }
    db.beginTransaction(err => {
        db.query('DELETE FROM purchase_order_detail WHERE material_id=?', [id], () => {
            db.query('DELETE FROM outbound_record_detail WHERE material_id=?', [id], () => {
                db.query('DELETE FROM stock WHERE material_id=?', [id], () => {
                    db.query('DELETE FROM material WHERE material_id=?', [id], () => { db.commit(() => res.json({msg: '删除成功'})); });
                });
            });
        });
    });
});

app.get('/api/purchase', (req, res) => {
    if (useMock) {
        const rows = mockData.purchase_order.map(po => {
            const s = mockData.supplier.find(sup => sup.supplier_id === po.supplier_id);
            const w = mockData.warehouse.find(wh => wh.warehouse_id === po.warehouse_id);
            return { po_id: po.po_id, supplier_id: po.supplier_id, warehouse_id: po.warehouse_id, total_amount: po.total_amount, date: po.date || '2025/12/22', supplier_name: s ? s.supplier_name : '未知', warehouse_name: w ? w.warehouse_name : '未知' };
        }).sort((a, b) => b.po_id - a.po_id);
        return res.json(rows);
    }
    db.query('SELECT po.*, s.supplier_name, w.warehouse_name FROM purchase_order po LEFT JOIN supplier s ON po.supplier_id=s.supplier_id LEFT JOIN warehouse w ON po.warehouse_id=w.warehouse_id ORDER BY po.po_id DESC', (e,r)=>res.json(r));
});

app.post('/api/purchase', (req, res) => {
    const { supplier_id, warehouse_id, material_id, qty, price } = req.body;
    if (useMock) {
        const newPoId = mockData.purchase_order.length > 0 ? Math.max(...mockData.purchase_order.map(p => p.po_id)) + 1 : 1;
        mockData.purchase_order.push({ po_id: newPoId, supplier_id: parseInt(supplier_id), warehouse_id: parseInt(warehouse_id), total_amount: qty * price, date: new Date().toISOString().split('T')[0].replace(/-/g, '/') });
        mockData.purchase_order_detail.push({ po_id: newPoId, material_id: parseInt(material_id), quantity: parseInt(qty), price: parseFloat(price) });
        const s = mockData.stock.find(st => st.warehouse_id === parseInt(warehouse_id) && st.material_id === parseInt(material_id));
        if (s) s.quantity += parseInt(qty); else mockData.stock.push({ warehouse_id: parseInt(warehouse_id), material_id: parseInt(material_id), quantity: parseInt(qty) });
        return res.json({ msg: '采购成功' });
    }
    db.beginTransaction(err => {
        db.query('INSERT INTO purchase_order (supplier_id, warehouse_id, total_amount) VALUES (?,?,?)', [supplier_id, warehouse_id, qty*price], (e, rPO) => {
            db.query('INSERT INTO purchase_order_detail (po_id, material_id, quantity, price) VALUES (?,?,?,?)', [rPO.insertId, material_id, qty, price], () => {
                db.query('INSERT INTO stock (warehouse_id, material_id, quantity) VALUES (?,?,?) ON DUPLICATE KEY UPDATE quantity=quantity+?', [warehouse_id, material_id, qty, qty], () => { db.commit(() => res.json({msg: '采购成功'})); });
            });
        });
    });
});

app.get('/api/outbound', (req, res) => {
    if (useMock) {
        const rows = mockData.outbound_record.map(o => {
            const w = mockData.warehouse.find(wh => wh.warehouse_id === o.warehouse_id);
            return { out_id: o.out_id, warehouse_id: o.warehouse_id, purpose: o.purpose, date: o.date || '2025/12/22', warehouse_name: w ? w.warehouse_name : '未知' };
        }).sort((a, b) => b.out_id - a.out_id);
        return res.json(rows);
    }
    db.query('SELECT o.*, w.warehouse_name FROM outbound_record o LEFT JOIN warehouse w ON o.warehouse_id=w.warehouse_id ORDER BY o.out_id DESC', (e,r)=>res.json(r));
});

app.post('/api/outbound', (req, res) => {
    const { warehouse_id, purpose, material_id, qty } = req.body;
    const wId = parseInt(warehouse_id), mId = parseInt(material_id), quantityVal = parseInt(qty);
    if (useMock) {
        const s = mockData.stock.find(st => st.warehouse_id === wId && st.material_id === mId);
        if (!s || s.quantity < quantityVal) return res.status(400).json({ error: '库存不足' });
        const newOutId = mockData.outbound_record.length > 0 ? Math.max(...mockData.outbound_record.map(o => o.out_id)) + 1 : 1;
        mockData.outbound_record.push({ out_id: newOutId, warehouse_id: wId, purpose: purpose, date: new Date().toISOString().split('T')[0].replace(/-/g, '/') });
        mockData.outbound_record_detail.push({ out_id: newOutId, material_id: mId, quantity: quantityVal });
        s.quantity -= quantityVal;
        return res.json({ msg: '领用成功' });
    }
    db.query('SELECT quantity FROM stock WHERE warehouse_id=? AND material_id=?', [warehouse_id, material_id], (e, rows) => {
        if(rows.length===0 || rows[0].quantity < qty) return res.status(400).json({error: '库存不足'});
        db.beginTransaction(err => {
            db.query('INSERT INTO outbound_record (warehouse_id, purpose) VALUES (?,?)', [warehouse_id, purpose], (e, rOut) => {
                db.query('INSERT INTO outbound_record_detail (out_id, material_id, quantity) VALUES (?,?,?)', [rOut.insertId, material_id, qty], () => {
                    db.query('UPDATE stock SET quantity=quantity-? WHERE warehouse_id=? AND material_id=?', [qty, warehouse_id, material_id], () => { db.commit(() => res.json({msg: '领用成功'})); });
                });
            });
        });
    });
});

app.get('/api/suppliers', (req, res) => {
    if (useMock) return res.json(mockData.supplier);
    db.query('SELECT * FROM supplier', (e,r)=>res.json(r));
});
app.get('/api/warehouses', (req, res) => {
    if (useMock) return res.json(mockData.warehouse);
    db.query('SELECT * FROM warehouse', (e,r)=>res.json(r));
});

app.get('/api/purchase/:id', (req, res) => {
    const pId = parseInt(req.params.id);
    if (useMock) {
        const details = mockData.purchase_order_detail.filter(pd => pd.po_id === pId).map(pd => {
            const m = mockData.materials.find(mat => mat.material_id === pd.material_id);
            return { material_name: m ? m.material_name : '未知', quantity: pd.quantity, price: pd.price };
        });
        return res.json(details);
    }
    db.query(`SELECT m.material_name, pd.quantity, pd.price FROM purchase_order_detail pd JOIN material m ON pd.material_id = m.material_id WHERE pd.po_id = ?`, [pId], (err, rows) => res.json(rows));
});

app.get('/api/outbound/:id', (req, res) => {
    const outId = parseInt(req.params.id);
    if (useMock) {
        const details = mockData.outbound_record_detail.filter(od => od.out_id === outId).map(od => {
            const m = mockData.materials.find(mat => mat.material_id === od.material_id);
            return { material_name: m ? m.material_name : '未知', quantity: od.quantity };
        });
        return res.json(details);
    }
    db.query(`SELECT m.material_name, od.quantity FROM outbound_record_detail od JOIN material m ON od.material_id = m.material_id WHERE od.out_id = ?`, [outId], (err, rows) => res.json(rows));
});

// ============================================
// 5. 启动监听（Render动态端口）
// ============================================
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
    console.log(`🚀 服务器启动成功！访问端口: ${PORT}`);
});