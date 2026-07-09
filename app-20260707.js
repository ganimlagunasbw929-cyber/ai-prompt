(function() {
    'use strict';

    const UNLOCK_STORAGE_KEY = 'gpt2_member_unlocked_v2';
    const CLOUDBASE_ENV = 'y-yaoqingma-d8g5xfyzq85f0410e';

    // ===== CloudBase Init =====
    let cloudbaseApp = null;
    let cloudbaseDb = null;
    let cloudbaseReady = false;

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
        totalCount.textContent = PROMPT_DATA.length;
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

    async function sha256(text) {
        const encoder = new TextEncoder();
        const data = encoder.encode(text);
        const hashBuffer = await crypto.subtle.digest('SHA-256', data);
        const hashArray = Array.from(new Uint8Array(hashBuffer));
        return hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
    }

    async function unlockWithInvite() {
        const code = inviteCodeInput.value.trim();
        if (!code) {
            showToast('请输入邀请码');
            return;
        }

        if (!cloudbaseReady || !cloudbaseApp) {
            showToast('邀请码服务暂不可用，请稍后再试');
            return;
        }

        inviteSubmit.disabled = true;
        try {
            const res = await cloudbaseApp.callFunction({
                name: 'verifyInviteCode',
                data: { code }
            });
            const result = res && res.result ? res.result : res;
            if (!result || !result.ok) {
                showToast((result && result.error) || '邀请码验证失败，请扫码申请');
                return;
            }
        } catch (e) {
            console.error('[CloudBase] verifyInviteCode failed:', e);
            showToast('邀请码服务暂不可用，请稍后再试');
            return;
        } finally {
            inviteSubmit.disabled = false;
        }

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
