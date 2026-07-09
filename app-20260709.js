(function() {
    'use strict';

    const UNLOCK_STORAGE_KEY = 'gpt2_member_unlocked_v2';
    const CLOUDBASE_ENV = 'y-yaoqingma-d8g5xfyzq85f0410e';

    // ===== CloudBase Init =====
    let cloudbaseApp = null;
    let cloudbaseDb = null;
    let cloudbaseReady = false;

    // 本地 SHA-256 计算
    function sha256(text) {
        if (window.crypto && window.crypto.subtle) {
            var encoder = new TextEncoder();
            var data = encoder.encode(String(text).trim());
            return crypto.subtle.digest('SHA-256', data).then(function(hash) {
                return Array.from(new Uint8Array(hash))
                    .map(function(b) { return b.toString(16).padStart(2, '0'); })
                    .join('');
            });
        }
        // 降级：纯JS实现
        return new Promise(function(resolve) {
            var msg = String(text).trim();
            var bytes = [];
            for (var i = 0; i < msg.length; i++) {
                bytes.push(msg.charCodeAt(i) & 0xff);
            }
            var bitLen = bytes.length * 8;
            bytes.push(0x80);
            while ((bytes.length + 8) % 64 !== 0) bytes.push(0);
            for (var i = 0; i < 4; i++) bytes.push(0);
            bytes.push((bitLen >>> 24) & 0xff);
            bytes.push((bitLen >>> 16) & 0xff);
            bytes.push((bitLen >>> 8) & 0xff);
            bytes.push(bitLen & 0xff);
            
            var H = [0x6a09e667,0xbb67ae85,0x3c6ef372,0xa54ff53a,0x510e527f,0x9b05688c,0x1f83d9ab,0x5be0cd19];
            var K = [0x428a2f98,0x71374491,0xb5c0fbcf,0xe9b5dba5,0x3956c25b,0x59f111f1,0x923f82a4,0xab1c5ed5,0xd807aa98,0x12835b01,0x243185be,0x550c7dc3,0x72be5d74,0x80deb1fe,0x9bdc06a7,0xc19bf174,0xe49b69c1,0xefbe4786,0x0fc19dc6,0x240ca1cc,0x2de92c6f,0x4a7484aa,0x5cb0a9dc,0x76f988da,0x983e5152,0xa831c66d,0xb00327c8,0xbf597fc7,0xc6e00bf3,0xd5a79147,0x06ca6351,0x14292967,0x27b70a85,0x2e1b2138,0x4d2c6dfc,0x53380d13,0x650a7354,0x766a0abb,0x81c2c92e,0x92722c85,0xa2bfe8a1,0xa81a664b,0xc24b8b70,0xc76c51a3,0xd192e819,0xd6990624,0xf40e3585,0x106aa070,0x19a4c116,0x1e376c08,0x2748774c,0x34b0bcb5,0x391c0cb3,0x4ed8aa4a,0x5b9cca4f,0x682e6ff3,0x748f82ee,0x78a5636f,0x84c87814,0x8cc70208,0x90befffa,0xa4506ceb,0xbef9a3f7,0xc67178f2];
            
            for (var chunk = 0; chunk < bytes.length; chunk += 64) {
                var W = new Array(64);
                for (var t = 0; t < 16; t++) {
                    W[t] = (bytes[chunk+t*4]<<24)|(bytes[chunk+t*4+1]<<16)|(bytes[chunk+t*4+2]<<8)|bytes[chunk+t*4+3];
                }
                for (var t = 16; t < 64; t++) {
                    var s0 = ((W[t-15]>>>7)|(W[t-15]<<25))^((W[t-15]>>>18)|(W[t-15]<<14))^(W[t-15]>>>3);
                    var s1 = ((W[t-2]>>>17)|(W[t-2]<<15))^((W[t-2]>>>19)|(W[t-2]<<13))^(W[t-2]>>>10);
                    W[t] = (W[t-16]+s0+W[t-7]+s1)|0;
                }
                var a=H[0],b=H[1],c=H[2],d=H[3],e=H[4],f=H[5],g=H[6],h=H[7];
                for (var t = 0; t < 64; t++) {
                    var S1=((e>>>6)|(e<<26))^((e>>>11)|(e<<21))^((e>>>25)|(e<<7));
                    var ch=(e&f)^((~e)&g);
                    var temp1=(h+S1+ch+K[t]+W[t])|0;
                    var S0=((a>>>2)|(a<<30))^((a>>>13)|(a<<19))^((a>>>22)|(a<<10));
                    var maj=(a&b)^(a&c)^(b&c);
                    var temp2=(S0+maj)|0;
                    h=g;g=f;f=e;e=(d+temp1)|0;d=c;c=b;b=a;a=(temp1+temp2)|0;
                }
                H[0]=(H[0]+a)|0;H[1]=(H[1]+b)|0;H[2]=(H[2]+c)|0;H[3]=(H[3]+d)|0;
                H[4]=(H[4]+e)|0;H[5]=(H[5]+f)|0;H[6]=(H[6]+g)|0;H[7]=(H[7]+h)|0;
            }
            resolve(H.map(function(h) { return (h>>>0).toString(16).padStart(8,'0'); }).join(''));
        });
    }

    // 本地邀请码验证（CloudBase 不可用时的备选方案）
    async function verifyLocalCode(code) {
        const codeHash = await sha256(code);
        console.log('[LocalVerify] Input code:', code, 'Hash:', codeHash);
        console.log('[LocalVerify] Available hashes:', (window.INVITE_CODES || []).map(function(h) { return h.hash; }));
        const now = new Date();
        // 检查本地使用记录
        const usedHashes = JSON.parse(localStorage.getItem('gpt2_used_hashes') || '[]');
        for (const item of (window.INVITE_CODES || [])) {
            if (item.hash === codeHash) {
                if (item.used || usedHashes.includes(codeHash)) {
                    return { ok: false, error: '邀请码已被使用' };
                }
                if (item.expires && now >= new Date(item.expires)) {
                    return { ok: false, error: '邀请码已过期' };
                }
                // 标记已使用
                usedHashes.push(codeHash);
                localStorage.setItem('gpt2_used_hashes', JSON.stringify(usedHashes));
                return { ok: true };
            }
        }
        console.log('[LocalVerify] No matching hash found for:', codeHash);
        return { ok: false, error: '无效的邀请码' };
    }

    async function initCloudBase() {
        try {
            if (typeof cloudbase === 'undefined') {
                console.warn('[CloudBase] SDK not loaded, falling back to local mode');
                return;
            }
            cloudbaseApp = cloudbase.init({ env: CLOUDBASE_ENV });
            await cloudbaseApp.auth({ persistence: 'local' }).anonymousAuthProvider().signIn();
            cloudbaseDb = cloudbaseApp.database();
            cloudbaseReady = true;
            console.log('[CloudBase] Anonymous login success');
        } catch (e) {
            console.warn('[CloudBase] Init failed, falling back to local mode:', e.message);
        }
    }

    // ===== State =====
    const rawFavorites = JSON.parse(localStorage.getItem('gpt2_favorites') || '[]');
    const favoriteVersion = localStorage.getItem('gpt2_favorites_version');

    const state = {
        search: '',
        activeCategory: null,
        activeType: '',
        showFavOnly: false,
        favorites: rawFavorites,
        theme: localStorage.getItem('gpt2_theme') || 'light',
        modalIndex: null,
        unlocked: localStorage.getItem(UNLOCK_STORAGE_KEY) === 'true'
    };

    // ===== DOM References =====
    const $ = (sel) => document.querySelector(sel);
    const $$ = (sel) => document.querySelectorAll(sel);

    const cardGrid = $('#cardGrid');
    const searchInput = $('#searchInput');
    const contentTabs = $('#contentTabs');
    const categoryTags = $('#categoryTags');
    const emptyState = $('#emptyState');
    const totalCount = $('#totalCount');
    const accessNote = $('#accessNote');
    const favFilterBtn = $('#favFilterBtn');
    const favCount = $('#favCount');
    const loginToggleBtn = $('#loginToggleBtn');
    const themeToggle = $('#themeToggle');
    const modalOverlay = $('#modalOverlay');
    const modalContent = $('#modalContent');
    const modalClose = $('#modalClose');
    const modalImage = $('#modalImage');
    const modalTitle = $('#modalTitle');
    const modalCategories = $('#modalCategories');
    const modalPrompt = $('#modalPrompt');
    const copyBtn = $('#copyBtn');
    const inviteOverlay = $('#inviteOverlay');
    const inviteClose = $('#inviteClose');
    const inviteCodeInput = $('#inviteCodeInput');
    const inviteSubmit = $('#inviteSubmit');
    const toast = $('#toast');

    // ===== Initialize =====
    function init() {
        migrateFavorites();
        applyTheme(state.theme);
        if (totalCount) totalCount.textContent = PROMPT_DATA.length;
        renderCategories();
        renderCards();
        updateFavCount();
        updateAccessState();
        bindEvents();
        initCloudBase();  // 异步初始化CloudBase
        // 窗口大小变化时重新检测分类标签收起按钮
        window.addEventListener('resize', () => {
            addCategoryToggle();
        });
    }

    // ===== Theme =====
    function applyTheme(theme) {
        document.documentElement.setAttribute('data-theme', theme);
        state.theme = theme;
        localStorage.setItem('gpt2_theme', theme);
    }

    function toggleTheme() {
        applyTheme(state.theme === 'light' ? 'dark' : 'light');
    }

    // ===== Favorites =====
    function itemKey(item) {
        return String(item && item.id);
    }

    function saveFavorites() {
        localStorage.setItem('gpt2_favorites', JSON.stringify(state.favorites));
        localStorage.setItem('gpt2_favorites_version', 'id');
    }

    function migrateFavorites() {
        if (favoriteVersion === 'id') {
            state.favorites = state.favorites.map(String);
            saveFavorites();
            return;
        }

        const leadingNewCount = PROMPT_DATA.findIndex(item => item.date !== '7.3');
        const offset = leadingNewCount > -1 ? leadingNewCount : 0;
        state.favorites = state.favorites
            .map(index => PROMPT_DATA[offset + Number(index)])
            .filter(Boolean)
            .map(itemKey);
        saveFavorites();
    }

    function isFav(item) {
        return state.favorites.includes(itemKey(item));
    }

    function toggleFav(item) {
        const key = itemKey(item);
        if (isFav(item)) {
            state.favorites = state.favorites.filter(i => i !== key);
        } else {
            state.favorites.push(key);
        }
        saveFavorites();
        updateFavCount();
    }

    function updateFavCount() {
        favCount.textContent = state.favorites.length;
    }

    // ===== Access =====
    function isMemberOnly(item) {
        return item.access === 'member';
    }

    function canReadFull(item) {
        return state.unlocked || !isMemberOnly(item);
    }

    function promptPreview(item) {
        const text = item.prompt_preview || item.prompt || '';
        if (canReadFull(item)) return text;
        return text.slice(0, 90) + '...';
    }

    function showInviteModal() {
        inviteOverlay.classList.add('show');
        document.body.style.overflow = 'hidden';
    }

    function closeInviteModal() {
        inviteOverlay.classList.remove('show');
        document.body.style.overflow = '';
    }

    function updateAccessState() {
        loginToggleBtn.textContent = state.unlocked ? '已解锁全部' : '邀请码登录';
        loginToggleBtn.classList.toggle('is-unlocked', state.unlocked);
        if (accessNote) {
            const freeCount = PROMPT_DATA.filter(item => item.access !== 'member').length;
            const memberCount = PROMPT_DATA.length - freeCount;
            accessNote.textContent = state.unlocked
                ? `已解锁全部 ${PROMPT_DATA.length} 条提示词`
                : `未登录可查看 ${freeCount} 条免费内容，${memberCount} 条会员内容需邀请码解锁`;
        }
    }

    async function unlockWithInvite() {
        const code = inviteCodeInput.value.trim();
        if (!code) {
            showToast('请输入邀请码');
            return;
        }

        inviteSubmit.disabled = true;
        let result = null;

        // 优先本地验证（CloudBase 云函数在新域名下不可用）
        result = await verifyLocalCode(code);

        // 本地验证失败时，尝试 CloudBase 作为备选
        if (!result || !result.ok) {
            if (cloudbaseReady && cloudbaseApp) {
                try {
                    const res = await cloudbaseApp.callFunction({
                        name: 'verifyInviteCode',
                        data: { code }
                    });
                    const cbResult = res && res.result ? res.result : res;
                    if (cbResult && cbResult.ok) {
                        result = cbResult;
                    }
                } catch (e) {
                    console.log('[CloudBase] 云函数不可用');
                }
            }
        }

        if (!result || !result.ok) {
            showToast((result && result.error) || '邀请码验证失败，请扫码申请');
            inviteSubmit.disabled = false;
            return;
        }

        inviteSubmit.disabled = false;
        state.unlocked = true;
        localStorage.setItem(UNLOCK_STORAGE_KEY, 'true');
        localStorage.removeItem('gpt2_unlocked');
        closeInviteModal();
        updateAccessState();
        renderCards();
        showToast('已解锁全部提示词');
    }

    // ===== Categories =====
    function getAllCategories() {
        const cats = new Set();
        PROMPT_DATA.filter(item => !state.activeType || item.type === state.activeType).forEach(item => {
            if (item.categories) {
                item.categories.forEach(c => cats.add(c));
            }
        });
        return Array.from(cats).sort();
    }

    function renderCategories() {
        const cats = getAllCategories();
        let html = '<span class="category-tag active" data-cat="">全部</span>';
        cats.forEach(cat => {
            html += `<span class="category-tag" data-cat="${cat}">${cat}</span>`;
        });
        categoryTags.innerHTML = html;

        // 添加收起/展开按钮（小屏自动检测）
        addCategoryToggle();
    }

    function addCategoryToggle() {
        // 移除旧的按钮
        const oldToggle = document.querySelector('.category-tag-toggle');
        if (oldToggle) oldToggle.remove();

        // 小屏才添加按钮
        if (window.innerWidth > 640) {
            categoryTags.classList.remove('is-expanded');
            return;
        }

        const btn = document.createElement('button');
        btn.className = 'category-tag-toggle';
        btn.textContent = categoryTags.classList.contains('is-expanded') ? '收起' : '展开';
        btn.addEventListener('click', (e) => {
            e.stopPropagation();
            const isExpanded = categoryTags.classList.toggle('is-expanded');
            btn.textContent = isExpanded ? '收起' : '展开';
        });
        categoryTags.after(btn);
    }

    // ===== Filtering =====
    function getFilteredData() {
        let data = PROMPT_DATA;

        if (state.activeType) {
            data = data.filter(item => item.type === state.activeType);
        }

        // Category filter
        if (state.activeCategory) {
            data = data.filter(item => item.categories && item.categories.includes(state.activeCategory));
        }

        // Fav filter
        if (state.showFavOnly) {
            data = data.filter(item => isFav(item));
        }

        // Search filter
        if (state.search.trim()) {
            const q = state.search.toLowerCase().trim();
            data = data.filter(item => {
                const titleMatch = item.title.toLowerCase().includes(q);
                const promptMatch = item.prompt.toLowerCase().includes(q);
                const catMatch = item.categories && item.categories.some(c => c.toLowerCase().includes(q));
                const metaMatch = [item.duration, item.ratio, item.tool, item.videoType, item.camera]
                    .filter(Boolean)
                    .join(' ')
                    .toLowerCase()
                    .includes(q);
                return titleMatch || promptMatch || catMatch || metaMatch;
            });
        }

        return data;
    }

    // ===== Render Cards =====
    function renderCards() {
        const filtered = getFilteredData();

        if (filtered.length === 0) {
            cardGrid.style.display = 'none';
            emptyState.style.display = 'block';
            return;
        }

        cardGrid.style.display = '';
        emptyState.style.display = 'none';

        let html = '';
        filtered.forEach((item, i) => {
            // Find original index in PROMPT_DATA for fav tracking
            const originalIdx = PROMPT_DATA.indexOf(item);
            const imgSrc = item.images && item.images.length > 0
                ? `images/thumbnails/${item.images[0]}`
                : '';
            const favActive = isFav(item) ? 'active' : '';
            const favFill = isFav(item) ? 'var(--fav-active)' : 'none';
            const locked = !canReadFull(item);
            const typeLabel = item.type === 'video' ? '视频提示词' : '图片提示词';
            const accessLabel = locked ? '会员' : '免费';
            const videoMeta = item.type === 'video'
                ? `<div class="video-meta">
                    <span>${escapeHtml(item.duration || '未注明')}</span>
                    <span>${escapeHtml(item.ratio || '未注明')}</span>
                    <span>${escapeHtml(item.tool || '通用')}</span>
                  </div>`
                : '';

            html += `
            <div class="prompt-card ${locked ? 'is-locked' : ''}" data-idx="${originalIdx}">
                ${imgSrc ? `<img class="prompt-card-image" src="${imgSrc}" alt="${item.title}" loading="lazy" onerror="this.style.display='none'">` : ''}
                <div class="prompt-card-body">
                    <div class="card-label-row">
                        <span class="type-pill">${typeLabel}</span>
                        <span class="access-pill ${locked ? 'member' : 'free'}">${accessLabel}</span>
                    </div>
                    <div class="prompt-card-title">${escapeHtml(item.title)}</div>
                    <div class="prompt-card-preview">${escapeHtml(promptPreview(item))}</div>
                    ${videoMeta}
                    <div class="prompt-card-tags">
                        ${item.categories ? item.categories.map(c => `<span class="prompt-card-tag">${c}</span>`).join('') : ''}
                    </div>
                    <div class="prompt-card-footer">
                        <button class="fav-btn ${favActive}" data-fav-idx="${originalIdx}">
                            <svg width="16" height="16" viewBox="0 0 24 24" fill="${favFill}" stroke="currentColor" stroke-width="2"><path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z"></path></svg>
                        </button>
                        <button class="copy-prompt-btn" data-copy-idx="${originalIdx}">
                            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="9" y="9" width="13" height="13" rx="2" ry="2"></rect><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"></path></svg>
                            复制
                        </button>
                    </div>
                </div>
            </div>`;
        });

        cardGrid.innerHTML = html;
    }

    // ===== Modal =====
    function openModal(idx) {
        const item = PROMPT_DATA[idx];
        if (!item) return;
        if (!canReadFull(item)) {
            showInviteModal();
            return;
        }

        state.modalIndex = idx;

        // Images
        if (item.images && item.images.length > 0) {
            let imgHtml = '';
            item.images.forEach(img => {
                imgHtml += `<img src="images/full/${img}" alt="${escapeHtml(item.title)}" loading="lazy" onerror="this.style.display='none'">`;
            });
            modalImage.innerHTML = imgHtml;
        } else {
            modalImage.innerHTML = '';
        }

        modalTitle.textContent = item.title;
        modalCategories.innerHTML = item.categories
            ? [
                `<span class="modal-cat-tag">${item.type === 'video' ? '视频提示词' : '图片提示词'}</span>`,
                item.duration ? `<span class="modal-cat-tag">${escapeHtml(item.duration)}</span>` : '',
                item.ratio ? `<span class="modal-cat-tag">${escapeHtml(item.ratio)}</span>` : '',
                item.tool ? `<span class="modal-cat-tag">${escapeHtml(item.tool)}</span>` : '',
                ...item.categories.map(c => `<span class="modal-cat-tag">${c}</span>`)
              ].join('')
            : '';
        modalPrompt.textContent = item.prompt;

        modalOverlay.classList.add('show');
        document.body.style.overflow = 'hidden';
    }

    function closeModal() {
        modalOverlay.classList.remove('show');
        document.body.style.overflow = '';
        state.modalIndex = null;
    }

    // ===== Toast =====
    function showToast(msg) {
        toast.textContent = msg;
        toast.classList.add('show');
        setTimeout(() => toast.classList.remove('show'), 2000);
    }

    // ===== Copy =====
    function copyPrompt(idx) {
        const item = PROMPT_DATA[idx];
        if (!item) return;
        if (!canReadFull(item)) {
            showInviteModal();
            return;
        }
        navigator.clipboard.writeText(item.prompt).then(() => {
            showToast('提示词已复制！');
        }).catch(() => {
            // Fallback
            const textarea = document.createElement('textarea');
            textarea.value = item.prompt;
            document.body.appendChild(textarea);
            textarea.select();
            document.execCommand('copy');
            document.body.removeChild(textarea);
            showToast('提示词已复制！');
        });
    }

    // ===== Escape HTML =====
    function escapeHtml(str) {
        if (!str) return '';
        const div = document.createElement('div');
        div.textContent = str;
        return div.innerHTML;
    }

    // ===== Event Binding =====
    function bindEvents() {
        // Theme toggle
        themeToggle.addEventListener('click', toggleTheme);

        // Search
        searchInput.addEventListener('input', (e) => {
            state.search = e.target.value;
            renderCards();
        });

        contentTabs.addEventListener('click', (e) => {
            const tab = e.target.closest('[data-type]');
            if (!tab) return;
            state.activeType = tab.dataset.type;
            state.activeCategory = null;
            $$('.content-tab').forEach(item => item.classList.remove('active'));
            tab.classList.add('active');
            renderCategories();
            renderCards();
            updateAccessState();
        });

        // Category tags
        categoryTags.addEventListener('click', (e) => {
            const tag = e.target.closest('.category-tag');
            if (!tag) return;
            const cat = tag.dataset.cat;
            state.activeCategory = cat || null;

            // Update active state
            $$('.category-tag').forEach(t => t.classList.remove('active'));
            tag.classList.add('active');
            renderCards();
        });

        // Fav filter
        favFilterBtn.addEventListener('click', () => {
            state.showFavOnly = !state.showFavOnly;
            favFilterBtn.classList.toggle('active', state.showFavOnly);
            renderCards();
        });

        loginToggleBtn.addEventListener('click', showInviteModal);

        // Card click (open modal) - delegated
        cardGrid.addEventListener('click', (e) => {
            // Fav button
            const favBtn = e.target.closest('.fav-btn');
            if (favBtn) {
                e.stopPropagation();
                const idx = parseInt(favBtn.dataset.favIdx);
                toggleFav(PROMPT_DATA[idx]);
                renderCards();
                return;
            }

            // Copy button
            const copyBtn = e.target.closest('.copy-prompt-btn');
            if (copyBtn) {
                e.stopPropagation();
                const idx = parseInt(copyBtn.dataset.copyIdx);
                copyPrompt(idx);
                return;
            }

            // Card click -> open modal
            const card = e.target.closest('.prompt-card');
            if (card) {
                const idx = parseInt(card.dataset.idx);
                openModal(idx);
            }
        });

        // Modal close
        modalClose.addEventListener('click', closeModal);
        modalOverlay.addEventListener('click', (e) => {
            if (e.target === modalOverlay) closeModal();
        });
        document.addEventListener('keydown', (e) => {
            if (e.key === 'Escape') closeModal();
        });

        // Modal copy button
        copyBtn.addEventListener('click', () => {
            if (state.modalIndex !== null) {
                copyPrompt(state.modalIndex);
            }
        });

        inviteClose.addEventListener('click', closeInviteModal);
        inviteOverlay.addEventListener('click', (e) => {
            if (e.target === inviteOverlay) closeInviteModal();
        });
        inviteSubmit.addEventListener('click', unlockWithInvite);
        inviteCodeInput.addEventListener('keydown', (e) => {
            if (e.key === 'Enter') unlockWithInvite();
        });
    }

    // ===== Start =====
    init();
})();
