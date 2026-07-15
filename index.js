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
    // 默认音源接口：公开的 Meting API 镜像，仅作示例，可能会失效，
    // 建议自行部署 Meting-API（GitHub: metowolf/Meting-API）后替换成自己的地址。
    apiEndpoint: "https://api.injahow.cn/meting/?server=netease&type=search&id=",
    backupUrls: [],          // 最多 5 条 [{name, url}]
    hideCounterSuffix: true, // 隐藏 s / t / #
    showAvatars: true,
    panelCollapsed: true,    // 设置面板默认收起，只显示标题
};

// ---------------- 运行时状态（不持久化） ----------------
let audioEl = null;
let playlist = [];       // [{title, artist, url}]
let playlistIndex = -1;
let isPluginActive = false;
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
// 默认折叠，只显示标题，点击标题展开/收起
// ============================================================
function buildSettingsPanel() {
    if ($('#mmb-settings-block').length) return; // 已存在，避免重复插入

    const settings = getSettings();

    const panel = $(`
    <div id="mmb-settings-block" class="flex-container flexFlowColumn ${settings.panelCollapsed ? 'mmb-collapsed' : ''}">
        <h4 class="title_restorable mmb-panel-title" title="点击展开/收起">
            <span>氛围音乐 &amp; 底栏美化</span>
            <i class="fa-solid fa-chevron-down mmb-caret"></i>
        </h4>

        <div class="mmb-panel-body">
            <div class="mmb-row">
                <label class="checkbox_label">
                    <input type="checkbox" id="mmb-enabled" ${settings.enabled ? 'checked' : ''}>
                    <span>手动启用（仅在未绑定任何美化时生效）</span>
                </label>
            </div>

            <div class="mmb-row">
                <small>绑定美化（可多选，切到这些 UI Theme 时自动开启，切走自动关闭；绑定后手动开关自动失效）：</small>
            </div>
            <div class="mmb-row">
                <input type="text" id="mmb-theme-search" class="text_pole" placeholder="搜索美化名称..." style="flex:1">
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
                <small class="mmb-hint">备用音源 URL（最多 5 条，自动搜索失败/播放报错时会依次尝试）：</small>
            </div>
            <div id="mmb-backup-list"></div>
            <div class="mmb-row">
                <div class="menu_button" id="mmb-add-backup">+ 添加备用音源</div>
                <div class="menu_button" id="mmb-save-backup">保存备用音源</div>
            </div>

            <div class="mmb-row">
                <div class="menu_button" id="mmb-test-play">测试播放当前角色的氛围音乐</div>
                <div class="menu_button" id="mmb-panel-pause-btn" title="暂停/播放">
                    <i class="fa-solid fa-pause"></i>
                    <span>暂停/播放</span>
                </div>
            </div>
        </div>
    </div>
    `);

    $('#CustomCSS-block').after(panel);

    // 展开/收起
    panel.find('.mmb-panel-title').on('click', function () {
        panel.toggleClass('mmb-collapsed');
        settings.panelCollapsed = panel.hasClass('mmb-collapsed');
        saveSettings();
    });

    refreshThemeList();
    renderBackupList();
    refreshEnabledCheckboxState();

    $('#mmb-enabled').on('change', function () {
        settings.enabled = $(this).is(':checked');
        saveSettings();
        evaluateActiveState();
    });

    $('#mmb-theme-search').on('input', function () {
        const q = $(this).val().trim().toLowerCase();
        $('#mmb-theme-list .mmb-theme-row').each(function () {
            const name = $(this).data('name').toLowerCase();
            $(this).toggleClass('mmb-filtered-out', q.length > 0 && !name.includes(q));
        });
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

    $('#mmb-panel-pause-btn').on('click', function () {
        togglePause();
    });
}

function refreshEnabledCheckboxState() {
    const settings = getSettings();
    const bound = settings.boundThemes.length > 0;
    const checkbox = $('#mmb-enabled');
    checkbox.prop('disabled', bound);
    checkbox.closest('.mmb-row').toggleClass('mmb-enabled-disabled', bound);
    if (bound) {
        // 绑定美化后，手动开关强制关闭，交由自动切换接管
        settings.enabled = false;
        checkbox.prop('checked', false);
        saveSettings();
    }
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
        <label class="checkbox_label mmb-theme-row" data-name="${name}">
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
        refreshEnabledCheckboxState();
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
        // 已绑定美化：只在绑定的美化被选中时自动开启，手动开关此时无效
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
// 底栏：#custom-music-bar，插入到 #nonQRFormItems 内，
// 通过 CSS order 强制排到最左侧，不依赖任何按钮的位置/顺序。
// 暂停按钮已移动到设置面板，底栏不再放置暂停按钮。
// ============================================================
function injectBar() {
    if ($('#custom-music-bar').length) return;

    const bar = $(`
    <div id="custom-music-bar">
        <div class="mmb-avatars">
            <img class="mmb-avatar mmb-avatar-char" src="" title="上一首（点击角色头像）">
            <img class="mmb-avatar mmb-avatar-user" src="" title="下一首（点击用户头像）">
        </div>
        <div class="mmb-track-info">
            <span class="mmb-title"></span>
            <span class="mmb-artist"></span>
        </div>
    </div>
    `);

    $('#nonQRFormItems').prepend(bar);

    updateAvatars();

    $('#custom-music-bar .mmb-avatar-char').on('click', () => prevTrack());
    $('#custom-music-bar .mmb-avatar-user').on('click', () => nextTrack());
}

function removeBar() {
    $('#custom-music-bar').remove();
}

// 获取头像：优先直接从聊天里已经渲染出来的头像 <img> 复制 src，
// 这是最可靠的方式，不依赖任何猜测出来的接口路径，
// 也天然兼容群聊（会拿到最近一条消息真正显示的头像）。
function updateAvatars() {
    try {
        let charSrc = '';
        let userSrc = '';

        const lastCharMes = $('#chat .mes[is_user="false"]').last();
        const lastUserMes = $('#chat .mes[is_user="true"]').last();

        if (lastCharMes.length) charSrc = lastCharMes.find('.avatar img').attr('src') || '';
        if (lastUserMes.length) userSrc = lastUserMes.find('.avatar img').attr('src') || '';

        // 回退方案 1：角色列表里对应 chid 的缩略图
        if (!charSrc) {
            const context = getContext();
            const charId = context.characterId;
            if (charId !== undefined) {
                charSrc = $(`#rm_print_characters_block .character_select[chid="${charId}"] img`).attr('src') || '';
            }
            // 回退方案 2：直接拼接缩略图接口
            if (!charSrc && context.characters?.[charId]?.avatar) {
                charSrc = `/thumbnail?type=avatar&file=${encodeURIComponent(context.characters[charId].avatar)}`;
            }
        }

        if (charSrc) $('#custom-music-bar .mmb-avatar-char').attr('src', charSrc);
        if (userSrc) $('#custom-music-bar .mmb-avatar-user').attr('src', userSrc);
    } catch (e) {
        console.warn('[mood-music-bar] 获取头像失败', e);
    }
}

function updateTrackInfoDisplay() {
    const track = playlist[playlistIndex];
    if (!track) {
        // 未播放时不显示任何占位文字，直接留空
        $('#custom-music-bar .mmb-title').text('');
        $('#custom-music-bar .mmb-artist').text('');
        return;
    }
    $('#custom-music-bar .mmb-title').text(track.title || '');
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
// 播放失败（含跨域/链接失效/接口返回异常）会自动尝试下一个候选，
// 候选耗尽再切换到备用音源列表。
// ============================================================
function getAudioEl() {
    if (!audioEl) {
        audioEl = new Audio();
        audioEl.addEventListener('ended', () => nextTrack(true));
        audioEl.addEventListener('error', () => onPlaybackError());
    }
    return audioEl;
}

let usingBackupList = false;

function onPlaybackError() {
    console.warn('[mood-music-bar] 当前曲目播放失败，尝试下一个候选');
    if (playlistIndex < playlist.length - 1) {
        playlistIndex += 1;
        playCurrentTrack();
        return;
    }
    if (!usingBackupList) {
        if (!useBackupPlaylist()) {
            updateTrackInfoDisplay();
            toastr?.warning?.('自动搜索与备用音源均播放失败，请检查音源接口/备用链接是否有效');
        }
    } else {
        updateTrackInfoDisplay();
        toastr?.warning?.('备用音源也播放失败了，请检查链接是否为可直接播放的音频地址');
    }
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

    let res;
    try {
        res = await fetch(settings.apiEndpoint + encodeURIComponent(query));
    } catch (e) {
        throw new Error('音源接口请求失败（网络/跨域错误）: ' + e.message);
    }
    if (!res.ok) throw new Error('音源接口请求失败，状态码: ' + res.status);

    let data;
    try {
        data = await res.json();
    } catch (e) {
        throw new Error('音源接口返回内容不是合法 JSON，接口可能已变更或失效');
    }

    const list = Array.isArray(data) ? data : (data.result?.songs || data.data || []);
    if (!Array.isArray(list) || list.length === 0) throw new Error('未搜索到匹配的歌曲');

    const mapped = list.slice(0, 10).map((item) => ({
        title: item.name || item.title || '',
        artist: item.artist || item.author || (Array.isArray(item.artists) ? item.artists.map(a => a.name).join('/') : ''),
        url: item.url || item.songUrl || '',
    })).filter(t => t.url);

    if (mapped.length === 0) throw new Error('搜索结果中没有可播放的音频链接（可能是版权限制）');
    return mapped;
}

function useBackupPlaylist() {
    const settings = getSettings();
    if (!settings.backupUrls.length) return false;
    usingBackupList = true;
    playlist = settings.backupUrls.map(b => ({ title: b.name || '', artist: '', url: b.url }));
    playlistIndex = 0;
    playCurrentTrack();
    return true;
}

async function startMoodMusicForCurrentCharacter(forceTest) {
    if (!isPluginActive && !forceTest) return;
    usingBackupList = false;
    try {
        currentMoodQuery = await buildMoodQueryForCurrentCharacter();
        const found = await searchMusicByQuery(currentMoodQuery);
        playlist = found;
        playlistIndex = 0;
        playCurrentTrack();
    } catch (e) {
        console.warn('[mood-music-bar] 自动搜索音乐失败，尝试使用备用音源：', e.message);
        if (!useBackupPlaylist()) {
            updateTrackInfoDisplay();
            toastr?.warning?.('自动搜索音乐失败（' + e.message + '），且未配置备用音源，可在设置面板中添加备用音源URL');
        }
    }
}

function playCurrentTrack() {
    const track = playlist[playlistIndex];
    if (!track) return;
    const audio = getAudioEl();
    audio.src = track.url;
    audio.play().catch((e) => {
        // 浏览器自动播放策略可能会拦截，需要用户先与页面交互一次；
        // 这不算真正的"播放失败"，所以这里不触发 onPlaybackError。
        console.warn('[mood-music-bar] 播放被拦截，可能需要用户先点一下页面/面板里的暂停播放按钮', e);
    });
    updateTrackInfoDisplay();
}

function nextTrack(auto = false) {
    if (playlist.length === 0) return;
    if (playlistIndex < playlist.length - 1) {
        playlistIndex += 1;
        playCurrentTrack();
    } else if (auto && !usingBackupList) {
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
        $('#mmb-panel-pause-btn i').removeClass('fa-play').addClass('fa-pause');
    } else {
        audio.pause();
        $('#mmb-panel-pause-btn i').removeClass('fa-pause').addClass('fa-play');
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

    eventSource.on(event_types.CHARACTER_MESSAGE_RENDERED, () => {
        stripKnownSuffixes();
        if (isPluginActive) updateAvatars();
    });
    eventSource.on(event_types.USER_MESSAGE_RENDERED, () => {
        stripKnownSuffixes();
        if (isPluginActive) updateAvatars();
    });

    // 初始状态判定
    evaluateActiveState();
});
