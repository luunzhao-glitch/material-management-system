// 模拟内存数据库（初始数据就是您页面里的 3 条物资）
let mockDatabase = [
    { id: 1, name: '东北大米稻种', category: '种子', spec: '50kg/袋', stock: 200 },
    { id: 2, name: '强效复合肥', category: '化肥', spec: '50kg/袋', stock: 80 },
    { id: 3, name: '测试种子', category: '种子', spec: '10kg/袋', stock: 40 }
];

let useMock = false; // 是否启用降级模式

// 尝试连接本地数据库
try {
    // 您的真实数据库连接代码（比如 mysql.createConnection...）
    // ...
} catch (error) {
    console.log("❌ 数据库连接失败，已自动降级为本地内存数据库（确保线上演示正常运行）！");
    useMock = true; // 开启降级模式
}

// 导出统一的查询接口
function queryMaterials() {
    if (useMock) {
        return Promise.resolve(mockDatabase); // 如果是降级模式，直接返回内存数据
    }
    // 否则去执行真实的 SQL 查询...
}

// 导出统一的新增接口
function addMaterial(item) {
    if (useMock) {
        item.id = mockDatabase.length + 1;
        mockDatabase.push(item);
        return Promise.resolve(item);
    }
    // 否则去执行真实的 SQL 插入...
}

// 导出统一的删除接口
function deleteMaterial(id) {
    if (useMock) {
        mockDatabase = mockDatabase.filter(item => item.id !== parseInt(id));
        return Promise.resolve(true);
    }
    // 否则去执行真实的 SQL 删除...
}

module.exports = { queryMaterials, addMaterial, deleteMaterial };