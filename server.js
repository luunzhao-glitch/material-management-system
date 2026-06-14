const express = require('express');
const mysql = require('mysql2');
const cors = require('cors');

const app = express();

app.use(cors());
app.use(express.json());

// ===============================
// 数据库连接
// ===============================
const db = mysql.createConnection({
    host: 'localhost',
    user: 'root',
    password: '数据库密码',
    database: 'agri_inventory_system'
});

db.connect(err => {
    if (err) {
        console.error('❌ 数据库连接失败:', err.message);
    } else {
        console.log('✅ MySQL 连接成功');
    }
});

// ===============================
// 工具：统一错误返回
// ===============================
function handleError(res, err) {
    console.error(err);
    return res.status(500).json({ error: err.message });
}

// ===============================
// 首页统计
// ===============================
app.get('/api/stats', (req, res) => {
    const stats = {};

    db.query('SELECT COUNT(*) AS c FROM material', (err, r1) => {
        if (err) return handleError(res, err);
        stats.mat = r1?.[0]?.c || 0;

        db.query('SELECT SUM(quantity) AS c FROM stock', (err, r2) => {
            if (err) return handleError(res, err);
            stats.stock = r2?.[0]?.c || 0;

            db.query('SELECT COUNT(*) AS c FROM stock WHERE quantity < 20', (err, r3) => {
                if (err) return handleError(res, err);
                stats.alert = r3?.[0]?.c || 0;

                db.query('SELECT COUNT(*) AS c FROM purchase_order', (err, r4) => {
                    if (err) return handleError(res, err);
                    stats.po = r4?.[0]?.c || 0;

                    res.json(stats);
                });
            });
        });
    });
});

// ===============================
// 图表数据
// ===============================
app.get('/api/charts', (req, res) => {
    const pieSql = `
        SELECT m.category AS name,
               SUM(IFNULL(s.quantity,0)) AS value
        FROM material m
        LEFT JOIN stock s ON m.material_id = s.material_id
        GROUP BY m.category
    `;

    const barSql = `
        SELECT w.warehouse_name AS name,
               SUM(IFNULL(s.quantity,0)) AS value
        FROM warehouse w
        LEFT JOIN stock s ON w.warehouse_id = s.warehouse_id
        GROUP BY w.warehouse_name
    `;

    db.query(pieSql, (err, pie) => {
        if (err) return handleError(res, err);

        db.query(barSql, (err, bar) => {
            if (err) return handleError(res, err);

            res.json({ pie, bar });
        });
    });
});

// ===============================
// 物资查询
// ===============================
app.get('/api/materials', (req, res) => {
    const sql = `
        SELECT m.material_id, m.material_name, m.category, m.spec, m.unit,
               SUM(IFNULL(s.quantity, 0)) AS stock
        FROM material m
        LEFT JOIN stock s ON m.material_id = s.material_id
        GROUP BY m.material_id
    `;

    db.query(sql, (err, rows) => {
        if (err) return handleError(res, err);
        res.json(rows);
    });
});

// ===============================
// 新增物资（智能）
// ===============================
app.post('/api/materials', (req, res) => {
    const { name, category, spec, stock } = req.body;
    const qty = Number(stock) || 0;

    db.query(
        'SELECT material_id FROM material WHERE material_name=?',
        [name],
        (err, rows) => {
            if (err) return handleError(res, err);

            if (rows.length > 0) {
                const id = rows[0].material_id;

                db.query(
                    `INSERT INTO stock (warehouse_id, material_id, quantity)
                     VALUES (1, ?, ?)
                     ON DUPLICATE KEY UPDATE quantity = quantity + ?`,
                    [id, qty, qty],
                    (err) => {
                        if (err) return handleError(res, err);
                        res.json({ msg: '已存在，库存已累加' });
                    }
                );

            } else {
                db.query(
                    'INSERT INTO material (material_name, category, spec) VALUES (?,?,?)',
                    [name, category, spec],
                    (err, r) => {
                        if (err) return handleError(res, err);

                        db.query(
                            'INSERT INTO stock (warehouse_id, material_id, quantity) VALUES (1, ?, ?)',
                            [r.insertId, qty],
                            (err) => {
                                if (err) return handleError(res, err);
                                res.json({ msg: '新增成功' });
                            }
                        );
                    }
                );
            }
        }
    );
});

// ===============================
// 修改物资
// ==================s=============
app.put('/api/materials', (req, res) => {
    const { id, name, category, spec, stock } = req.body;

    db.query(
        'UPDATE material SET material_name=?, category=?, spec=? WHERE material_id=?',
        [name, category, spec, id],
        (err) => {
            if (err) return handleError(res, err);

            db.query('DELETE FROM stock WHERE material_id=?', [id], (err) => {
                if (err) return handleError(res, err);

                db.query(
                    'INSERT INTO stock (warehouse_id, material_id, quantity) VALUES (1, ?, ?)',
                    [id, stock],
                    (err) => {
                        if (err) return handleError(res, err);
                        res.json({ msg: '修改成功' });
                    }
                );
            });
        }
    );
});

// ===============================
// 删除物资（修复事务）
// ===============================
app.delete('/api/materials/:id', (req, res) => {
    const id = req.params.id;

    db.beginTransaction(err => {
        if (err) return handleError(res, err);

        db.query('DELETE FROM purchase_order_detail WHERE material_id=?', [id], (err) => {
            if (err) return db.rollback(() => handleError(res, err));

            db.query('DELETE FROM outbound_record_detail WHERE material_id=?', [id], (err) => {
                if (err) return db.rollback(() => handleError(res, err));

                db.query('DELETE FROM stock WHERE material_id=?', [id], (err) => {
                    if (err) return db.rollback(() => handleError(res, err));

                    db.query('DELETE FROM material WHERE material_id=?', [id], (err) => {
                        if (err) return db.rollback(() => handleError(res, err));

                        db.commit(err => {
                            if (err) return db.rollback(() => handleError(res, err));
                            res.json({ msg: '删除成功' });
                        });
                    });
                });
            });
        });
    });
});

// ===============================
// 采购
// ===============================
app.post('/api/purchase', (req, res) => {
    const { supplier_id, warehouse_id, material_id, qty, price } = req.body;
    // ===============================
// 采购列表 & 详情
// ===============================
    app.get('/api/purchase', (req, res) => {
        const sql = `
        SELECT po.po_id, po.total_amount, po.po_date,
               s.supplier_name, w.warehouse_name
        FROM purchase_order po
        JOIN supplier s ON po.supplier_id = s.supplier_id
        JOIN warehouse w ON po.warehouse_id = w.warehouse_id
        ORDER BY po.po_id DESC
    `;
        db.query(sql, (err, rows) => {
            if (err) return handleError(res, err);
            res.json(rows);
        });
    });

    app.get('/api/purchase/:id', (req, res) => {
        const sql = `
        SELECT m.material_name, d.quantity, d.price
        FROM purchase_order_detail d
        JOIN material m ON d.material_id = m.material_id
        WHERE d.po_id = ?
    `;
        db.query(sql, [req.params.id], (err, rows) => {
            if (err) return handleError(res, err);
            res.json(rows);
        });
    });

    db.beginTransaction(err => {
        if (err) return handleError(res, err);

        db.query(
            'INSERT INTO purchase_order (supplier_id, warehouse_id, total_amount) VALUES (?,?,?)',
            [supplier_id, warehouse_id, qty * price],
            (err, r) => {
                if (err) return db.rollback(() => handleError(res, err));

                db.query(
                    'INSERT INTO purchase_order_detail (po_id, material_id, quantity, price) VALUES (?,?,?,?)',
                    [r.insertId, material_id, qty, price],
                    (err) => {
                        if (err) return db.rollback(() => handleError(res, err));

                        db.query(
                            `INSERT INTO stock (warehouse_id, material_id, quantity)
                             VALUES (?,?,?)
                             ON DUPLICATE KEY UPDATE quantity=quantity+?`,
                            [warehouse_id, material_id, qty, qty],
                            (err) => {
                                if (err) return db.rollback(() => handleError(res, err));

                                db.commit(err => {
                                    if (err) return db.rollback(() => handleError(res, err));
                                    res.json({ msg: '采购成功' });
                                });
                            }
                        );
                    }
                );
            }
        );
    });
});

// ===============================
// 领用
// ===============================
app.post('/api/outbound', (req, res) => {
    const { warehouse_id, material_id, qty, purpose } = req.body;
    // ===============================
// 领用列表 & 详情
// ===============================
    app.get('/api/outbound', (req, res) => {
        const sql = `
        SELECT o.out_id, o.purpose, o.out_date, w.warehouse_name
        FROM outbound_record o
        JOIN warehouse w ON o.warehouse_id = w.warehouse_id
        ORDER BY o.out_id DESC
    `;
        db.query(sql, (err, rows) => {
            if (err) return handleError(res, err);
            res.json(rows);
        });
    });

    app.get('/api/outbound/:id', (req, res) => {
        const sql = `
        SELECT m.material_name, d.quantity
        FROM outbound_record_detail d
        JOIN material m ON d.material_id = m.material_id
        WHERE d.out_id = ?
    `;
        db.query(sql, [req.params.id], (err, rows) => {
            if (err) return handleError(res, err);
            res.json(rows);
        });
    });
    db.query(
        'SELECT quantity FROM stock WHERE warehouse_id=? AND material_id=?',
        [warehouse_id, material_id],
        (err, rows) => {
            if (err) return handleError(res, err);

            const stock = rows?.[0]?.quantity || 0;

            if (stock < qty) {
                return res.status(400).json({
                    error: `库存不足，当前只有 ${stock}`
                });
            }

            db.beginTransaction(err => {
                if (err) return handleError(res, err);

                db.query(
                    'INSERT INTO outbound_record (warehouse_id, purpose) VALUES (?,?)',
                    [warehouse_id, purpose],
                    (err, r) => {
                        if (err) return db.rollback(() => handleError(res, err));

                        db.query(
                            'INSERT INTO outbound_record_detail (out_id, material_id, quantity) VALUES (?,?,?)',
                            [r.insertId, material_id, qty],
                            (err) => {
                                if (err) return db.rollback(() => handleError(res, err));

                                db.query(
                                    'UPDATE stock SET quantity=quantity-? WHERE warehouse_id=? AND material_id=?',
                                    [qty, warehouse_id, material_id],
                                    (err) => {
                                        if (err) return db.rollback(() => handleError(res, err));

                                        db.commit(err => {
                                            if (err) return db.rollback(() => handleError(res, err));
                                            res.json({ msg: '领用成功' });
                                        });
                                    }
                                );
                            }
                        );
                    }
                );
            });
        }
    );
});

// ===============================
// 基础数据
// ===============================
app.get('/api/suppliers', (req, res) => {
    db.query('SELECT * FROM supplier', (err, r) => {
        if (err) return handleError(res, err);
        res.json(r);
    });
});

app.get('/api/warehouses', (req, res) => {
    db.query('SELECT * FROM warehouse', (err, r) => {
        if (err) return handleError(res, err);
        res.json(r);
    });
});

// ===============================
// 启动
// ===============================
app.listen(3000, () => {
    console.log('🚀 服务器运行：http://localhost:3000');
});