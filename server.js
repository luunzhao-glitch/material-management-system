const express = require('express');
const mysql = require('mysql2');
const cors = require('cors');
const path = require('path');

const app = express();
app.use(cors());
app.use(express.json());
app.use(express.static(__dirname));

app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'index.html'));
});
// ============================================
// 1. 数据库连接配置
// ============================================
const db = mysql.createConnection({
    host: 'localhost',
    user: 'root',
    password: '123456', // <--- 请务必修改这里！！！
    database: 'agri_inventory_system'
});

db.connect(err => {
    if (err) {
        console.error('❌ 数据库连接失败:', err.message);
        console.error('请检查 Navicat 里的密码是否正确！');
    } else {
        console.log('✅ MySQL 数据库连接成功！');
    }
});

// ============================================
// 2. 核心业务接口
// ============================================

// --- 首页统计与图表 ---
app.get('/api/stats', (req, res) => {
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
    const sqlPie = `SELECT m.category as name, SUM(IFNULL(s.quantity,0)) as value FROM material m LEFT JOIN stock s ON m.material_id=s.material_id GROUP BY m.category`;
    const sqlBar = `SELECT w.warehouse_name as name, SUM(IFNULL(s.quantity,0)) as value FROM warehouse w LEFT JOIN stock s ON w.warehouse_id=s.warehouse_id GROUP BY w.warehouse_name`;
    db.query(sqlPie, (e, pie) => {
        db.query(sqlBar, (e, bar) => { res.json({pie, bar}); });
    });
});

// --- 物资管理 (查询/新增/修改/删除) ---
app.get('/api/materials', (req, res) => {
    // 聚合查询，防止重复
    const sql = `SELECT m.material_id, m.material_name, m.category, m.spec, m.unit, SUM(IFNULL(s.quantity, 0)) as stock FROM material m LEFT JOIN stock s ON m.material_id = s.material_id GROUP BY m.material_id`;
    db.query(sql, (err, rows) => res.json(rows));
});

// 智能新增：存在则累加，不存在则新增
app.post('/api/materials', (req, res) => {
    const { name, category, spec, stock } = req.body;
    const qty = parseInt(stock) || 0;

    // 1. 查重
    db.query('SELECT material_id FROM material WHERE material_name = ?', [name], (err, rows) => {
        if(err) return res.status(500).json(err);

        if(rows.length > 0) {
            // 已存在 -> 累加库存 (默认入到1号库)
            const id = rows[0].material_id;
            db.query('INSERT INTO stock (warehouse_id, material_id, quantity) VALUES (1, ?, ?) ON DUPLICATE KEY UPDATE quantity = quantity + ?', [id, qty, qty], () => {
                res.json({ msg: `物资已存在，库存已累加 ${qty}` });
            });
        } else {
            // 新增
            db.query('INSERT INTO material (material_name, category, spec) VALUES (?,?,?)', [name, category, spec], (err, r) => {
                if(err) return res.status(500).json(err);
                db.query('INSERT INTO stock (warehouse_id, material_id, quantity) VALUES (1, ?, ?)', [r.insertId, qty], () => {
                    res.json({ msg: '新物资添加成功' });
                });
            });
        }
    });
});

// 修改物资信息

// ============================================
app.put('/api/materials', (req, res) => {
    const { id, name, category, spec, stock } = req.body;

    // 1. 更新基本信息
    db.query('UPDATE material SET material_name=?, category=?, spec=? WHERE material_id=?', [name, category, spec, id], (err) => {
        if(err) return res.status(500).json(err);

        // 2. 【关键一步】先删除该物资在“所有仓库”的库存记录
        db.query('DELETE FROM stock WHERE material_id = ?', [id], (err) => {
            if(err) return res.status(500).json(err);

            // 3. 重新插入一条记录到 1 号仓库，数量等于你输入的
            db.query('INSERT INTO stock (warehouse_id, material_id, quantity) VALUES (1, ?, ?)', [id, stock], () => {
                res.json({ msg: '修改成功（库存已重置）' });
            });
        });
    });
});
// 强力删除 (事务)
app.delete('/api/materials/:id', (req, res) => {
    const id = req.params.id;
    db.beginTransaction(err => {
        if(err) return res.status(500).json(err);
        db.query('DELETE FROM purchase_order_detail WHERE material_id=?', [id], () => {
            db.query('DELETE FROM outbound_record_detail WHERE material_id=?', [id], () => {
                db.query('DELETE FROM stock WHERE material_id=?', [id], () => {
                    db.query('DELETE FROM material WHERE material_id=?', [id], () => {
                        db.commit(() => res.json({msg: '删除成功'}));
                    });
                });
            });
        });
    });
});

// --- 采购与领用 ---
app.get('/api/purchase', (req, res) => {
    db.query('SELECT po.*, s.supplier_name, w.warehouse_name FROM purchase_order po LEFT JOIN supplier s ON po.supplier_id=s.supplier_id LEFT JOIN warehouse w ON po.warehouse_id=w.warehouse_id ORDER BY po.po_id DESC', (e,r)=>res.json(r));
});

app.post('/api/purchase', (req, res) => {
    const { supplier_id, warehouse_id, material_id, qty, price } = req.body;
    db.beginTransaction(err => {
        db.query('INSERT INTO purchase_order (supplier_id, warehouse_id, total_amount) VALUES (?,?,?)', [supplier_id, warehouse_id, qty*price], (e, rPO) => {
            if(e) return db.rollback();
            db.query('INSERT INTO purchase_order_detail (po_id, material_id, quantity, price) VALUES (?,?,?,?)', [rPO.insertId, material_id, qty, price], () => {
                db.query('INSERT INTO stock (warehouse_id, material_id, quantity) VALUES (?,?,?) ON DUPLICATE KEY UPDATE quantity=quantity+?', [warehouse_id, material_id, qty, qty], () => {
                    db.commit(() => res.json({msg: '采购成功'}));
                });
            });
        });
    });
});

app.get('/api/outbound', (req, res) => {
    db.query('SELECT o.*, w.warehouse_name FROM outbound_record o LEFT JOIN warehouse w ON o.warehouse_id=w.warehouse_id ORDER BY o.out_id DESC', (e,r)=>res.json(r));
});

app.post('/api/outbound', (req, res) => {
    const { warehouse_id, purpose, material_id, qty } = req.body;
    // 校验库存
    db.query('SELECT quantity FROM stock WHERE warehouse_id=? AND material_id=?', [warehouse_id, material_id], (e, rows) => {
        if(rows.length===0 || rows[0].quantity < qty) return res.status(400).json({error: `库存不足，当前只有 ${rows.length?rows[0].quantity:0}`});

        db.beginTransaction(err => {
            db.query('INSERT INTO outbound_record (warehouse_id, purpose) VALUES (?,?)', [warehouse_id, purpose], (e, rOut) => {
                db.query('INSERT INTO outbound_record_detail (out_id, material_id, quantity) VALUES (?,?,?)', [rOut.insertId, material_id, qty], () => {
                    db.query('UPDATE stock SET quantity=quantity-? WHERE warehouse_id=? AND material_id=?', [qty, warehouse_id, material_id], () => {
                        db.commit(() => res.json({msg: '领用成功'}));
                    });
                });
            });
        });
    });
});

// --- 基础数据 ---
app.get('/api/suppliers', (req, res) => db.query('SELECT * FROM supplier', (e,r)=>res.json(r)));
app.get('/api/warehouses', (req, res) => db.query('SELECT * FROM warehouse', (e,r)=>res.json(r)));
// ============================================
// 补充接口：查看单据详情
// ============================================

// 1. 获取某张采购单的明细 (GET /api/purchase/:id)
app.get('/api/purchase/:id', (req, res) => {
    const sql = `
        SELECT m.material_name, pd.quantity, pd.price 
        FROM purchase_order_detail pd
        JOIN material m ON pd.material_id = m.material_id
        WHERE pd.po_id = ?
    `;
    db.query(sql, [req.params.id], (err, rows) => {
        if(err) return res.status(500).json(err);
        res.json(rows);
    });
});

// 2. 获取某张领用单的明细 (GET /api/outbound/:id)
app.get('/api/outbound/:id', (req, res) => {
    const sql = `
        SELECT m.material_name, od.quantity 
        FROM outbound_record_detail od
        JOIN material m ON od.material_id = m.material_id
        WHERE od.out_id = ?
    `;
    db.query(sql, [req.params.id], (err, rows) => {
        if(err) return res.status(500).json(err);
        res.json(rows);
    });
});
// ============================================
// 3. 启动监听
// ============================================
app.listen(3000, () => {
    console.log('-------------------------------------------');
    console.log('🚀 服务器启动成功！');
    console.log('📡 访问地址: http://localhost:3000');
    console.log('-------------------------------------------');
});