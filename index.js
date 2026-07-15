// ============================================================
// 氛围音乐 & 底栏美化 - index.js
// ============================================================
// 依赖 SillyTavern 内建的扩展 API。
// 若你的酒馆目录结构不同，可能需要微调下面两行 import 路径。
import { extension_settings, getContext } from "../../../extensions.js";
import { saveSettingsDebounced, eventSource, event_types } from "../../../../script.js";

const EXT_ID = "mood-music-bar";

const defaultSettings = {
    enabled: true,          // 未绑定任何美化时的手动总开关（自由开关）
    boundThemes: [],         // 绑定的 UI Theme（美化）名称列表，可多选
    apiEndpoint: "https://meting-api.imsyy.top/?server=netease&type=search&id=", // 备用音源搜索接口（best-effort，可能需要你自行更换为可用的音源接口）
    backupUrls: [],          // 最多 5 条 [{name, url}]
    hideCounterSuffix: true, // 隐藏 s / t / #
    showAvatars: true,
};

// ---------------- 运行时状态（不持久化） ----------------
let audioEl = null;
let playlist = [];       // [{title, artist, url}]
let playlistIndex = -1;
let isPluginActive = false;
let barInjected = false;
let currentMoodQuery = "";

// ============================================================
// 设置读写
// ============================================================
function getSettings() {
    if (!extension_settings[EXT_ID]) {
        extension_settings[EXT_ID] = structuredClone(defaultSettings);
    }
    for (const key of Object.keys(defaultSettings)) {
        if (extension_settings[EXT_ID][key] === undefined) {
            extension_settings[EXT_ID][key] = structuredClone(defaultSettings[key]);
        }
    }
    return extension_settings[EXT_ID];
}

function saveSettings() {
    saveSettingsDebounced();
}

// ============================================================
// 设置面板：插入到 “自定义CSS”（#CustomCSS-block）下方
// ============================================================
function buildSettingsPanel() {
    if ($('#mmb-settings-block').length) return; // 已存在，避免重复插入

    const settings = getSettings();

    const panel = $(`
    <div id="mmb-settings-block" class="flex-container flexFlowColumn">
        <h4 class="title_restorable" title="角色氛围音乐 & 底栏美化插件设置">
            <span>氛围音乐 &amp; 底栏美化</span>
        </h4>

        <div class="mmb-row">
            <label class="checkbox_label">
                <input type="checkbox" id="mmb-enabled" ${settings.enabled ? 'checked' : ''}>
                <span>手动启用（未绑定任何美化时生效；绑定美化后由自动切换接管）</span>
            </label>
        </div>

        <div class="mmb-row">
            <small>绑定美化（可多选，切到这些 UI Theme 时自动开启，切走自动关闭）：</small>
        </div>
        <div class="mmb-theme-list" id="mmb-theme-list"></div>

        <div class="mmb-row">
            <label class="checkbox_label">
                <input type="checkbox" id="mmb-hide-suffix" ${settings.hideCounterSuffix ? 'checked' : ''}>
                <span>隐藏计时器"s" / token计数"t" / 楼层号前的"#"</span>
            </label>
        </div>

        <div class="mmb-row">
            <small class="mmb-hint">自动音源接口（找不到歌时可自行更换为可用的音乐搜索API）：</small>
        </div>
        <div class="mmb-row">
            <input type="text" id="mmb-api-endpoint" class="text_pole" style="flex:1" value="${settings.apiEndpoint}">
        </div>

        <div class="mmb-row">
            <small class="mmb-hint">备用音源 URL（最多 5 条，自动搜索失败时会依次使用）：</small>
        </div>
        <div id="mmb-backup-list"></div>
        <div class="mmb-row">
            <div class="menu_button" id="mmb-add-backup">+ 添加备用音源</div>
            <div class="menu_button" id="mmb-save-backup">保存备用音源</div>
        </div>

        <div class="mmb-row">
            <div class="menu_button" id="mmb-test-play">测试播放当前角色的氛围音乐</div>
        </div>
    </div>
    `);

    $('#CustomCSS-block').after(panel);

    // 填充美化（UI Theme）列表
    refreshThemeList();

    // 填充备用音源列表
    renderBackupList();

    // 绑定事件
    $('#mmb-enabled').on('change', function () {
        settings.enabled = $(this).is(':checked');
        saveSettings();
        evaluateActiveState();
    });

    $('#mmb-hide-suffix').on('change', function () {
        settings.hideCounterSuffix = $(this).is(':checked');
        saveSettings();
    });

    $('#mmb-api-endpoint').on('change', function () {
        settings.apiEndpoint = $(this).val().trim();
        saveSettings();
    });

    $('#mmb-add-backup').on('click', function () {
        if (settings.backupUrls.length >= 5) {
            toastr?.warning?.('最多只能添加 5 条备用音源');
            return;
        }
        settings.backupUrls.push({ name: '', url: '' });
        renderBackupList();
    });

    $('#mmb-save-backup').on('click', function () {
        const rows = $('#mmb-backup-list .mmb-backup-row');
        const list = [];
        rows.each(function () {
            const name = $(this).find('.mmb-backup-name').val().trim();
            const url = $(this).find('.mmb-backup-url').val().trim();
            if (url) list.push({ name: name || url, url });
        });
        settings.backupUrls = list.slice(0, 5);
        saveSettings();
        renderBackupList();
        toastr?.success?.('备用音源已保存');
    });

    $('#mmb-test-play').on('click', function () {
        startMoodMusicForCurrentCharacter(true);
    });
}

function renderBackupList() {
    const settings = getSettings();
    const container = $('#mmb-backup-list');
    container.empty();
    settings.backupUrls.forEach((item, idx) => {
        const row = $(`
        <div class="mmb-backup-row">
            <input type="text" class="text_pole mmb-backup-name" placeholder="曲名（可留空）" value="${item.name || ''}">
            <input type="text" class="text_pole mmb-backup-url" placeholder="音频直链 URL" value="${item.url || ''}">
            <div class="menu_button fa-solid fa-trash-can mmb-remove-backup" data-idx="${idx}"></div>
        </div>
        `);
        container.append(row);
    });
    container.find('.mmb-remove-backup').on('click', function () {
        const idx = Number($(this).data('idx'));
        settings.backupUrls.splice(idx, 1);
        saveSettings();
        renderBackupList();
    });
}

function refreshThemeList() {
    const settings = getSettings();
    const listEl = $('#mmb-theme-list');
    listEl.empty();

    const themeNames = [];
    $('#themes option').each(function () {
        const val = $(this).val() || $(this).text();
        if (val) themeNames.push(val);
    });

    if (themeNames.length === 0) {
        listEl.append('<small class="mmb-hint">未检测到已保存的 UI Theme，请先在上方 "UI Theme" 处保存至少一个美化预设。</small>');
        return;
    }

    themeNames.forEach((name) => {
        const checked = settings.boundThemes.includes(name) ? 'checked' : '';
        const row = $(`
        <label class="checkbox_label">
            <input type="checkbox" class="mmb-theme-checkbox" value="${name}" ${checked}>
            <span>${name}</span>
        </label>
        `);
        listEl.append(row);
    });

    listEl.find('.mmb-theme-checkbox').on('change', function () {
        const name = $(this).val();
        if ($(this).is(':checked')) {
            if (!settings.boundThemes.includes(name)) settings.boundThemes.push(name);
        } else {
            settings.boundThemes = settings.boundThemes.filter(n => n !== name);
        }
        saveSettings();
        evaluateActiveState();
    });
}

// ============================================================
// 美化（UI Theme）切换监听 -> 自动开关插件
// ============================================================
function getCurrentThemeName() {
    return $('#themes').val() || $('#themes option:selected').text() || '';
}

function evaluateActiveState() {
    const settings = getSettings();
    let shouldBeActive;

    if (settings.boundThemes.length > 0) {
        // 已绑定美化：只在绑定的美化被选中时自动开启
        shouldBeActive = settings.boundThemes.includes(getCurrentThemeName());
    } else {
        // 未绑定任何美化：完全由手动开关决定（自由开关）
        shouldBeActive = settings.enabled;
    }

    if (shouldBeActive !== isPluginActive) {
        setPluginActive(shouldBeActive);
    }
}

function setPluginActive(active) {
    isPluginActive = active;
    $('body').toggleClass('mmb-active', active);

    if (active) {
        injectBar();
        hideOriginalTextNodes();
        startCounterSuffixObserver();
        startMoodMusicForCurrentCharacter(false);
    } else {
        stopAudio();
        // 不删除任何原生元素/文字，只移除我们自己注入的条
        removeBar();
        restoreOriginalTextNodes();
    }
}

// ============================================================
// 底栏：#custom-music-bar，插入到 #nonQRFormItems 最前面
// ============================================================
function injectBar() {
    if ($('#custom-music-bar').length) return;

    const bar = $(`
    <div id="custom-music-bar">
        <div class="mmb-avatars">
            <img class="mmb-avatar mmb-avatar-char" src="" title="上一首（点击角色头像）">
            <img class="mmb-avatar mmb-avatar-user" src="" title="下一首（点击用户头像）">
        </div>
        <div class="mmb-pause-btn fa-solid fa-pause" title="暂停/播放"></div>
        <div class="mmb-track-info">
            <span class="mmb-title">未播放</span>
            <span class="mmb-artist"></span>
        </div>
    </div>
    `);

    $('#nonQRFormItems').prepend(bar);
    barInjected = true;

    updateAvatars();

    $('#custom-music-bar .mmb-avatar-char').on('click', () => prevTrack());
    $('#custom-music-bar .mmb-avatar-user').on('click', () => nextTrack());
    $('#custom-music-bar .mmb-pause-btn').on('click', () => togglePause());
}

function removeBar() {
    $('#custom-music-bar').remove();
    barInjected = false;
}

function updateAvatars() {
    try {
        const context = getContext();
        const charId = context.characterId;
        let charAvatarUrl = '';
        let userAvatarUrl = '';

        if (charId !== undefined && context.characters?.[charId]?.avatar) {
            const avatarFile = context.characters[charId].avatar;
            charAvatarUrl = `/thumbnail?type=avatar&file=${encodeURIComponent(avatarFile)}`;
        }

        // 用户头像：SillyTavern 的用户头像路径，若你的版本不同，请手动调整此处路径
        if (context.userAvatar) {
            userAvatarUrl = `/thumbnail?type=persona&file=${encodeURIComponent(context.userAvatar)}`;
        }

        if (charAvatarUrl) $('#custom-music-bar .mmb-avatar-char').attr('src', charAvatarUrl);
        if (userAvatarUrl) $('#custom-music-bar .mmb-avatar-user').attr('src', userAvatarUrl);
    } catch (e) {
        console.warn('[mood-music-bar] 获取头像失败', e);
    }
}

function updateTrackInfoDisplay() {
    const track = playlist[playlistIndex];
    if (!track) {
        $('#custom-music-bar .mmb-title').text('未播放');
        $('#custom-music-bar .mmb-artist').text('');
        return;
    }
    $('#custom-music-bar .mmb-title').text(track.title || '未知曲名');
    $('#custom-music-bar .mmb-artist').text(track.artist || '');
}

// ============================================================
// 隐藏 / 恢复 #nonQRFormItems 原本的文字节点（只隐藏，不删除）
// ============================================================
function hideOriginalTextNodes() {
    const container = document.getElementById('nonQRFormItems');
    if (!container) return;
    container.childNodes.forEach((node) => {
        if (node.nodeType === Node.TEXT_NODE && node.textContent.trim().length > 0) {
            if (!node.parentElement || node.parentElement.id !== 'nonQRFormItems') return;
            const span = document.createElement('span');
            span.className = 'mmb-hidden-text';
            span.textContent = node.textContent;
            node.parentNode.replaceChild(span, node);
        }
    });
}

function restoreOriginalTextNodes() {
    document.querySelectorAll('#nonQRFormItems .mmb-hidden-text').forEach((span) => {
        const textNode = document.createTextNode(span.textContent);
        span.parentNode.replaceChild(textNode, span);
    });
}

// ============================================================
// 计时器 "s" / token "t" / 楼层号 "#" 隐藏（只在插件激活时生效）
// ============================================================
let suffixObserver = null;

function stripKnownSuffixes(root = document) {
    const settings = getSettings();
    if (!settings.hideCounterSuffix || !isPluginActive) return;

    root.querySelectorAll('.mesIDDisplay').forEach((el) => {
        const t = el.textContent;
        const stripped = t.replace(/^#/, '');
        if (stripped !== t) el.textContent = stripped;
    });
    root.querySelectorAll('.mes_timer').forEach((el) => {
        const t = el.textContent;
        const stripped = t.replace(/s\s*$/, '');
        if (stripped !== t) el.textContent = stripped;
    });
    root.querySelectorAll('.tokenCounterDisplay').forEach((el) => {
        const t = el.textContent;
        const stripped = t.replace(/t\s*$/, '');
        if (stripped !== t) el.textContent = stripped;
    });
}

function startCounterSuffixObserver() {
    stripKnownSuffixes();
    if (suffixObserver) return;
    const chat = document.getElementById('chat');
    if (!chat) return;
    suffixObserver = new MutationObserver((mutations) => {
        if (!isPluginActive) return;
        for (const m of mutations) {
            if (m.target && m.target.nodeType === Node.ELEMENT_NODE) {
                stripKnownSuffixes(m.target);
            } else if (m.target && m.target.parentElement) {
                stripKnownSuffixes(m.target.parentElement);
            }
        }
    });
    suffixObserver.observe(chat, { childList: true, subtree: true, characterData: true, characterDataOldValue: true });
}

// ============================================================
// 音乐：读取角色文本 -> 生成氛围关键词 -> 搜索 -> 播放
// ============================================================
function getAudioEl() {
    if (!audioEl) {
        audioEl = new Audio();
        audioEl.addEventListener('ended', () => nextTrack(true));
    }
    return audioEl;
}

async function buildMoodQueryForCurrentCharacter() {
    const context = getContext();
    const charId = context.characterId;
    const char = context.characters?.[charId];
    if (!char) return '';

    const text = [char.description, char.personality, char.scenario, char.first_mes]
        .filter(Boolean).join('\n').slice(0, 1500);

    if (!text) return char.name || '';

    // 优先尝试用当前连接的模型总结氛围关键词；若失败则退化为简单截取
    try {
        const prompt = `阅读以下角色设定，只输出2到4个用空格分隔的关键词（中文或英文均可），用来搜索匹配该角色气质的背景音乐，不要输出任何解释或标点：\n${text}`;
        const result = await context.generateQuietPrompt(prompt, false, true);
        const cleaned = (result || '').replace(/[\n\r"“”]/g, ' ').trim();
        if (cleaned) return cleaned;
    } catch (e) {
        console.warn('[mood-music-bar] 关键词生成失败，使用角色名作为搜索词', e);
    }
    return char.name || text.slice(0, 20);
}

async function searchMusicByQuery(query) {
    const settings = getSettings();
    if (!settings.apiEndpoint) throw new Error('未配置音源接口');
    const res = await fetch(settings.apiEndpoint + encodeURIComponent(query));
    if (!res.ok) throw new Error('音源接口请求失败: ' + res.status);
    const data = await res.json();
    const list = Array.isArray(data) ? data : (data.result?.songs || data.data || []);
    if (!Array.isArray(list) || list.length === 0) throw new Error('未搜索到匹配的歌曲');

    return list.slice(0, 10).map((item) => ({
        title: item.name || item.title || '未知曲名',
        artist: item.artist || item.author || (Array.isArray(item.artists) ? item.artists.map(a => a.name).join('/') : '未知歌手'),
        url: item.url || item.songUrl || '',
    })).filter(t => t.url);
}

function useBackupPlaylist() {
    const settings = getSettings();
    if (!settings.backupUrls.length) return false;
    playlist = settings.backupUrls.map(b => ({ title: b.name || '备用音源', artist: '', url: b.url }));
    playlistIndex = 0;
    playCurrentTrack();
    return true;
}

async function startMoodMusicForCurrentCharacter(forceTest) {
    if (!isPluginActive && !forceTest) return;
    try {
        currentMoodQuery = await buildMoodQueryForCurrentCharacter();
        const found = await searchMusicByQuery(currentMoodQuery);
        playlist = found;
        playlistIndex = 0;
        playCurrentTrack();
    } catch (e) {
        console.warn('[mood-music-bar] 自动搜索音乐失败，尝试使用备用音源', e);
        if (!useBackupPlaylist()) {
            updateTrackInfoDisplay();
            toastr?.warning?.('未找到氛围音乐，且未配置备用音源，可在设置面板中添加备用音源URL');
        }
    }
}

function playCurrentTrack() {
    const track = playlist[playlistIndex];
    if (!track) return;
    const audio = getAudioEl();
    audio.src = track.url;
    audio.play().catch((e) => {
        // 浏览器自动播放策略可能会拦截，需要用户先与页面交互一次
        console.warn('[mood-music-bar] 播放被拦截，需用户手动点击一次页面/暂停按钮', e);
    });
    updateTrackInfoDisplay();
    $('#custom-music-bar .mmb-pause-btn').removeClass('fa-play').addClass('fa-pause');
}

function nextTrack(auto = false) {
    if (playlist.length === 0) return;
    if (playlistIndex < playlist.length - 1) {
        playlistIndex += 1;
        playCurrentTrack();
    } else if (auto) {
        // 播完一轮后，重新按角色氛围搜索下一批
        startMoodMusicForCurrentCharacter(false);
    } else {
        playlistIndex = 0;
        playCurrentTrack();
    }
}

function prevTrack() {
    if (playlist.length === 0) return;
    playlistIndex = (playlistIndex - 1 + playlist.length) % playlist.length;
    playCurrentTrack();
}

function togglePause() {
    const audio = getAudioEl();
    if (audio.paused) {
        audio.play().catch(() => {});
        $('#custom-music-bar .mmb-pause-btn').removeClass('fa-play').addClass('fa-pause');
    } else {
        audio.pause();
        $('#custom-music-bar .mmb-pause-btn').removeClass('fa-pause').addClass('fa-play');
    }
}

function stopAudio() {
    if (audioEl) {
        audioEl.pause();
        audioEl.src = '';
    }
    playlist = [];
    playlistIndex = -1;
}

// ============================================================
// 初始化
// ============================================================
jQuery(async () => {
    getSettings();
    buildSettingsPanel();

    // 监听美化（UI Theme）切换
    $(document).on('change', '#themes', () => {
        refreshThemeList();
        evaluateActiveState();
    });

    // 角色 / 聊天切换时，重新生成氛围音乐 & 头像
    eventSource.on(event_types.CHAT_CHANGED, () => {
        if (!isPluginActive) return;
        updateAvatars();
        startMoodMusicForCurrentCharacter(false);
    });

    eventSource.on(event_types.CHARACTER_MESSAGE_RENDERED, () => stripKnownSuffixes());
    eventSource.on(event_types.USER_MESSAGE_RENDERED, () => stripKnownSuffixes());

    // 初始状态判定
    evaluateActiveState();
});
