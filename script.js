let cachedMaterials = [];
const API_URL = '/api';

document.addEventListener('DOMContentLoaded', () => {
    initNavigation();
    loadStats();      // 首页
    loadMaterials();  // 物资页

    // 绑定按钮事件
    // 1. 新增物资
    const addMatBtn = document.getElementById('btn-add-mat');
    if(addMatBtn) addMatBtn.onclick = () => showMatModal('新增物资', '', '', '', '', '');

    // 2. 新建采购单 (点击时才去加载下拉框数据)
    const addPoBtn = document.getElementById('btn-add-po');
    if(addPoBtn) addPoBtn.onclick = openPurchaseModal;

    // 3. 新建领用单
    const addOutBtn = document.getElementById('btn-add-out');
    if(addOutBtn) addOutBtn.onclick = openOutboundModal;
});

// ================== 物资管理模块 ==================
function loadMaterials() {
    fetch(`${API_URL}/materials`).then(r => r.json()).then(data => {
        cachedMaterials = data; // 更新缓存
        const tbody = document.querySelector('#table-mat tbody');
        if (!tbody) return;

        // map 函数增加了 index 参数
        tbody.innerHTML = data.map((i, index) => `
            <tr>
                <!-- 这里显示 index + 1，这就是连续的 1,2,3,4... -->
                <td>${index + 1}</td>
                
                <td>${i.material_name}</td>
                <td>${i.category}</td>
                <td>${i.spec}</td>
                <td>${i.stock || 0}</td>
                <td>
                    <!-- 注意：按钮里还是必须用真实的 i.material_id，否则后端不知道删谁 -->
                    <button onclick="editMat(${i.material_id})" class="btn-sm" style="background:#f39c12;color:white;margin-right:5px">编辑</button>
                    <button onclick="delMat(${i.material_id})" class="btn-sm" style="background:#e74c3c;color:white">删除</button>
                </td>
            </tr>
        `).join('');
    });
}

window.editMat = function(id) {
    const item = cachedMaterials.find(m => m.material_id === id);
    if(item) showMatModal('编辑物资', item.material_id, item.material_name, item.category, item.spec, item.stock);
};

window.showMatModal = function(title, id, name, cat, spec, stock) {
    const safeId = id || '';
    // 这里新增了 库存输入框
    showModal(title, `
        <input id="f_id" type="hidden" value="${safeId}">
        <label>名称</label><input id="f_name" value="${name||''}" class="input-block">
        <label>类别</label><input id="f_cat" value="${cat||''}" class="input-block">
        <label>规格</label><input id="f_spec" value="${spec||''}" class="input-block">
        <label>库存</label><input id="f_stock" type="number" value="${stock||0}" class="input-block">
        <button onclick="submitMat()" class="btn btn-primary" style="margin-top:10px;width:100%">保存</button>
    `);
};

window.submitMat = function() {
    const id = document.getElementById('f_id').value;
    const body = {
        id: id,
        name: document.getElementById('f_name').value,
        category: document.getElementById('f_cat').value,
        spec: document.getElementById('f_spec').value,
        stock: document.getElementById('f_stock').value
    };

    // 简单校验：名字不能为空
    if (!body.name) return alert('请输入物资名称！');

    const method = id ? 'PUT' : 'POST';

    fetch(`${API_URL}/materials`, {
        method: method,
        headers: {'Content-Type':'application/json'},
        body: JSON.stringify(body)
    }).then(async res => {
        // 1. 先解析后端返回的 JSON 数据
        const data = await res.json();

        // 2. 判断请求是否成功 (状态码 200-299 为 true)
        if (res.ok) {
            // --- 成功逻辑 ---
            alert(id ? '修改成功' : '新增成功');
            closeModal();       // 关闭弹窗
            loadMaterials();    // 刷新列表
            loadStats();        // 刷新首页统计
        } else {
            // --- 失败逻辑 ---
            // 显示后端返回的 error 字段，如果没有则显示默认文字
            alert(data.error || '操作失败，请检查数据');
        }
    }).catch(err => {
        // 网络错误等
        console.error(err);
        alert('请求发送失败，请检查服务器是否启动');
    });
};

window.delMat = function(id) {
    if(confirm('删除?')) fetch(`${API_URL}/materials/${id}`, {method:'DELETE'}).then(()=>{ loadMaterials(); alert('删除成功'); });
};

// ================== 采购入库模块 ==================
function loadPurchase() {
    fetch(`${API_URL}/purchase`).then(r => r.json()).then(data => {
        const tbody = document.querySelector('#table-po tbody');
        if (tbody) tbody.innerHTML = data.map(i => `
            <tr>
                <td>PO-${i.po_id}</td>
                <td>${i.supplier_name}</td>
                <td>${i.warehouse_name}</td>
                <td>${new Date(i.po_date).toLocaleDateString()}</td>
                <td>${i.total_amount}</td>
                <!-- 这里的操作栏加了按钮 -->
                <td><button onclick="viewPoDetail(${i.po_id})" class="btn-sm" style="background:#3498db;color:white">查看详情</button></td>
            </tr>`).join('');
    });
}

// 打开采购弹窗前，先去后端拿数据填下拉框
async function openPurchaseModal() {
    const [sups, wares, mats] = await Promise.all([
        fetch(`${API_URL}/suppliers`).then(r=>r.json()),
        fetch(`${API_URL}/warehouses`).then(r=>r.json()),
        fetch(`${API_URL}/materials`).then(r=>r.json())
    ]);

    showModal('新建采购入库单', `
        <label>供应商</label><select id="f_sup" class="input-block">${sups.map(s=>`<option value="${s.supplier_id}">${s.supplier_name}</option>`).join('')}</select>
        <label>入库仓库</label><select id="f_ware" class="input-block">${wares.map(w=>`<option value="${w.warehouse_id}">${w.warehouse_name}</option>`).join('')}</select>
        <label>物资</label><select id="f_mat" class="input-block">${mats.map(m=>`<option value="${m.material_id}">${m.material_name}</option>`).join('')}</select>
        <label>数量</label><input id="f_qty" type="number" class="input-block">
        <label>单价</label><input id="f_price" type="number" class="input-block">
        <button onclick="submitPO()" class="btn btn-primary" style="margin-top:10px;width:100%">确认入库</button>
    `);
}

window.submitPO = function() {
    // 1. 获取按钮对象
    const btn = document.querySelector('#modal-body button.btn-primary');

    // 2. 如果按钮已经是“禁用”状态，直接返回，防止重复点击
    if (btn.disabled) return;

    // 3. 立即禁用按钮，并修改文字提示
    btn.disabled = true;
    btn.textContent = '提交中...';

    const body = {
        supplier_id: document.getElementById('f_sup').value,
        warehouse_id: document.getElementById('f_ware').value,
        material_id: document.getElementById('f_mat').value,
        qty: document.getElementById('f_qty').value,
        price: document.getElementById('f_price').value
    };

    fetch(`${API_URL}/purchase`, {
        method: 'POST',
        headers: {'Content-Type':'application/json'},
        body: JSON.stringify(body)
    }).then(async res => {
        // 4. 请求结束，恢复按钮状态
        btn.disabled = false;
        btn.textContent = '确认入库';

        if(res.ok) {
            closeModal();
            loadPurchase();
            alert('采购入库成功');
        } else {
            alert('入库失败');
        }
    }).catch(err => {
        btn.disabled = false;
        alert('网络错误');
    });
};

// ================== 物资领用模块 ==================
function loadOutbound() {
    fetch(`${API_URL}/outbound`).then(r => r.json()).then(data => {
        const tbody = document.querySelector('#table-out tbody');
        if (tbody) tbody.innerHTML = data.map(i => `
            <tr>
                <td>OUT-${i.out_id}</td>
                <td>${i.warehouse_name}</td>
                <td>${new Date(i.out_date).toLocaleDateString()}</td>
                <td>${i.purpose}</td>
                <!-- 这里的操作栏加了按钮 -->
                <td><button onclick="viewOutDetail(${i.out_id})" class="btn-sm" style="background:#3498db;color:white">查看详情</button></td>
            </tr>`).join('');
    });
}
async function openOutboundModal() {
    const [wares, mats] = await Promise.all([
        fetch(`${API_URL}/warehouses`).then(r=>r.json()),
        fetch(`${API_URL}/materials`).then(r=>r.json())
    ]);
    showModal('新建物资领用单', `
        <label>出库仓库</label><select id="f_ware" class="input-block">${wares.map(w=>`<option value="${w.warehouse_id}">${w.warehouse_name}</option>`).join('')}</select>
        <label>物资</label><select id="f_mat" class="input-block">${mats.map(m=>`<option value="${m.material_id}">${m.material_name}</option>`).join('')}</select>
        <label>领用数量</label><input id="f_qty" type="number" class="input-block">
        <label>用途</label><input id="f_pur" class="input-block">
        <button onclick="submitOut()" class="btn btn-primary" style="margin-top:10px;width:100%">确认领用</button>
    `);
}

window.submitOut = function() {
    const body = {
        warehouse_id: document.getElementById('f_ware').value,
        material_id: document.getElementById('f_mat').value,
        qty: Number(document.getElementById('f_qty').value),
        purpose: document.getElementById('f_pur').value
    };

    fetch(`${API_URL}/outbound`, {
        method: 'POST',
        headers: {'Content-Type':'application/json'},
        body: JSON.stringify(body)
    }).then(async res => {
        const data = await res.json();
        if (res.status === 400) {
            // 【亮点】处理后端返回的业务逻辑错误
            alert(`操作失败：${data.error}`);
        } else if (res.status === 500) {
            alert('服务器内部错误');
        } else {
            closeModal();
            loadOutbound();
            alert('领用成功');
        }
    });
};

// ================== 基础数据模块 ==================
function loadBasic() {
    fetch(`${API_URL}/suppliers`).then(r=>r.json()).then(d=>{
        const t = document.querySelector('#table-sup tbody');
        if(t) t.innerHTML = d.map(i=>`<tr><td>${i.supplier_id}</td><td>${i.supplier_name}</td><td>${i.contact}</td></tr>`).join('');
    });
    fetch(`${API_URL}/warehouses`).then(r=>r.json()).then(d=>{
        const t = document.querySelector('#table-ware tbody');
        if(t) t.innerHTML = d.map(i=>`<tr><td>${i.warehouse_id}</td><td>${i.warehouse_name}</td></tr>`).join('');
    });
}

// ================== 通用工具 ==================
function showModal(title, html) {
    const modal = document.getElementById('modal-overlay');
    const body = document.getElementById('modal-body');
    body.innerHTML = `<h3>${title}</h3>${html}<button onclick="closeModal()" class="btn btn-secondary" style="margin-top:5px;width:100%">取消</button>`;
    modal.style.display = 'flex';
}

window.closeModal = function() {
    document.getElementById('modal-overlay').style.display = 'none';
};
// ================== 单据详情查看逻辑 ==================

// 查看采购单详情
window.viewPoDetail = function(id) {
    fetch(`${API_URL}/purchase/${id}`).then(r => r.json()).then(data => {
        // 生成表格 HTML
        const rows = data.map(d => `
            <tr><td>${d.material_name}</td><td>${d.quantity}</td><td>${d.price}</td></tr>
        `).join('');

        showModal(`采购单 PO-${id} 详情`, `
            <table class="data-table" style="width:100%">
                <thead><tr><th>物资名称</th><th>数量</th><th>单价</th></tr></thead>
                <tbody>${rows}</tbody>
            </table>
            <button onclick="closeModal()" class="btn btn-primary" style="margin-top:15px;width:100%">关闭</button>
        `);
    });
};

// 查看领用单详情
window.viewOutDetail = function(id) {
    fetch(`${API_URL}/outbound/${id}`).then(r => r.json()).then(data => {
        const rows = data.map(d => `
            <tr><td>${d.material_name}</td><td>${d.quantity}</td></tr>
        `).join('');

        showModal(`领用单 OUT-${id} 详情`, `
            <table class="data-table" style="width:100%">
                <thead><tr><th>物资名称</th><th>领用数量</th></tr></thead>
                <tbody>${rows}</tbody>
            </table>
            <button onclick="closeModal()" class="btn btn-primary" style="margin-top:15px;width:100%">关闭</button>
        `);
    });
};
// --- 加载图表与统计 ---
function loadStats() {
    // 1. 加载基础数字
    fetch(`${API_URL}/stats`).then(r => r.json()).then(d => {
        if(document.getElementById('stat-mat')) document.getElementById('stat-mat').innerText = d.mat;
        if(document.getElementById('stat-stock')) document.getElementById('stat-stock').innerText = d.stock;
        if(document.getElementById('stat-alert')) document.getElementById('stat-alert').innerText = d.alert;
        if(document.getElementById('stat-po')) document.getElementById('stat-po').innerText = d.po;
    });

    // 2. 加载 ECharts 图表
    fetch(`${API_URL}/charts`).then(r => r.json()).then(data => {
        // 初始化饼图
        const pieChart = echarts.init(document.getElementById('chart-pie'));
        pieChart.setOption({
            tooltip: {
                trigger: 'item',
                formatter: '{b}: {c} ({d}%)' // <--- 加上这一行，显示百分比
            },
            legend: { top: '5%', left: 'center' },
            series: [{
                name: '库存分布',
                type: 'pie',
                radius: ['40%', '70%'],
                data: data.pie,
                itemStyle: { borderRadius: 10, borderColor: '#fff', borderWidth: 2 },
                // 如果你想在图表上直接显示百分比标签，加上这个 label 配置
                label: {
                    show: true,
                    formatter: '{b}: {d}%'
                }
            }]
        });

        // 初始化柱状图
        const barChart = echarts.init(document.getElementById('chart-bar'));
        barChart.setOption({
            tooltip: {},
            xAxis: { type: 'category', data: data.bar.map(i => i.name) },
            yAxis: { type: 'value' },
            series: [{
                data: data.bar.map(i => i.value),
                type: 'bar',
                itemStyle: { color: '#2ecc71' }
            }]
        });

        // 窗口大小改变时自动重绘
        window.onresize = () => { pieChart.resize(); barChart.resize(); };
    });
}

function initNavigation() {
    const navLinks = document.querySelectorAll('.nav-link');
    const sections = document.querySelectorAll('.section');
    navLinks.forEach(link => {
        link.addEventListener('click', (e) => {
            e.preventDefault();
            navLinks.forEach(n => n.classList.remove('active'));
            sections.forEach(s => s.classList.remove('active'));
            link.classList.add('active');
            const targetId = link.getAttribute('href').substring(1);
            document.getElementById(targetId).classList.add('active');

            // 切换页面时，加载对应数据
            if(targetId === 'materials') loadMaterials();
            if(targetId === 'purchase') loadPurchase();
            if(targetId === 'outbound') loadOutbound();
            if(targetId === 'basic') loadBasic();
            if(targetId === 'dashboard') loadStats();
        });
    });
}