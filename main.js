'use strict';

const obsidian = require('obsidian');

// 添加默认设置
const DEFAULT_SETTINGS = {
    notesFolder: 'notes',
    unprocessedButtonColor: '#FF5722'  // 默认颜色
};

class NoteCardsPlugin extends obsidian.Plugin {
    settings = DEFAULT_SETTINGS;

    async onload() {
        await this.loadSettings();

        // 添加设置选项卡
        this.addSettingTab(new NoteCardsSettingTab(this.app, this));

        this.registerView(
            'note-cards-view',
            (leaf) => new CardView(leaf, this)
        );

        this.addCommand({
            id: 'open-note-cards',
            name: '打开闪念笔记卡片视图',
            callback: () => {
                this.activateView();
            }
        });
    }

    async loadSettings() {
        this.settings = Object.assign({}, DEFAULT_SETTINGS, await this.loadData());
    }

    async saveSettings() {
        await this.saveData(this.settings);
    }

    async loadNotes() {
        const folder = this.app.vault.getAbstractFileByPath(this.settings.notesFolder);
        if (!(folder instanceof obsidian.TFolder)) {
            console.error('指定的文件夹不存在');
            return [];
        }

        const notes = [];
        for (const file of folder.children) {
            if (file instanceof obsidian.TFile && file.extension === 'md') {
                const content = await this.app.vault.read(file);
                const frontmatter = this.app.metadataCache.getFileCache(file)?.frontmatter || {};
                notes.push({
                    file,
                    isProcessed: frontmatter.processed || false,
                    content,
                    link: frontmatter.link || '',  // 从frontmatter中获取link字段
                    createdTime: file.stat.ctime
                });
            }
        }
        
        return notes.sort((a, b) => b.createdTime - a.createdTime);
    }

    async activateView() {
        const { workspace } = this.app;
        
        let leaf = workspace.getLeavesOfType('note-cards-view')[0];
        if (!leaf) {
            leaf = workspace.getRightLeaf(false);
            await leaf.setViewState({
                type: 'note-cards-view',
                active: true,
            });
        }
        workspace.revealLeaf(leaf);
    }
}

// 添加设置选项卡类
class NoteCardsSettingTab extends obsidian.PluginSettingTab {
    constructor(app, plugin) {
        super(app, plugin);
        this.plugin = plugin;
    }

    display() {
        const {containerEl} = this;
        containerEl.empty();

        containerEl.createEl('h2', {text: '笔记卡片设置'});

        new obsidian.Setting(containerEl)
            .setName('笔记文件夹')
            .setDesc('指定存放笔记的文件夹路径（相对于 vault 根目录）')
            .addText(text => text
                .setPlaceholder('例如：notes')
                .setValue(this.plugin.settings.notesFolder)
                .onChange(async (value) => {
                    this.plugin.settings.notesFolder = value;
                    await this.plugin.saveSettings();
                }));

        new obsidian.Setting(containerEl)
            .setName('未整理按钮颜色')
            .setDesc('设置未整理状态按钮的颜色')
            .addColorPicker(color => color
                .setValue(this.plugin.settings.unprocessedButtonColor)
                .onChange(async (value) => {
                    this.plugin.settings.unprocessedButtonColor = value;
                    await this.plugin.saveSettings();
                    // 更新所有未整理按钮的颜色
                    document.querySelectorAll('button.unprocessed').forEach(button => {
                        button.style.backgroundColor = value;
                    });
                }));
    }
}

class CardView extends obsidian.ItemView {
    constructor(leaf, plugin) {
        super(leaf);
        this.plugin = plugin;
        this.notes = [];
        this.currentFilter = undefined;
        this.currentSort = 'mtime'; // 默认按修改时间排序
    }

    getViewType() {
        return 'note-cards-view';
    }

    getDisplayText() {
        return '笔记卡片';
    }

    getIcon() {
        return "layout-grid";
    }

    async onOpen() {
        this.notes = await this.plugin.loadNotes();
        await this.renderView();

        // 添加内部链接的点击事件处理
        this.containerEl.addEventListener('click', (e) => {
            const link = e.target.closest('.internal-link');
            if (link) {
                e.preventDefault();
                e.stopPropagation();
                const fileName = link.getAttribute('data-href');
                const file = this.app.vault.getAbstractFileByPath(`${fileName}.md`);
                if (file) {
                    this.app.workspace.getLeaf(true).openFile(file);
                }
            }
        });
    }

    async renderView() {
        const container = this.containerEl.children[1];
        container.empty();
        
        // 添加按钮容器
        const buttonContainer = container.createDiv('button-container');
        
        // 添加过滤按钮组
        const filterGroup = buttonContainer.createDiv('filter-group');
        const allButton = filterGroup.createEl('button', { text: '全部' });
        const processedButton = filterGroup.createEl('button', { text: '已整理' });
        const unprocessedButton = filterGroup.createEl('button', { text: '未整理' });

        // 添加工具按钮组
        const toolGroup = buttonContainer.createDiv('tool-group');
        
        // 添加刷新按钮（使用图标）
        const refreshButton = toolGroup.createEl('button', { 
            cls: 'tool-button refresh-button',
            attr: {'aria-label': '刷新'}
        });
        obsidian.setIcon(refreshButton, 'refresh-cw');

        // 添加刷新按钮点击事件
        refreshButton.onclick = async () => {
            await this.loadNotes();
            this.displayNotes(cardsContainer, this.currentFilter);
            new obsidian.Notice('笔记已刷新');
        };

        // 添加排序下拉菜单
        const sortGroup = toolGroup.createDiv('sort-group');
        const sortButton = sortGroup.createEl('button', {
            cls: 'tool-button sort-button',
            attr: {'aria-label': '排序方式'}
        });
        obsidian.setIcon(sortButton, 'arrow-down-up');
        
        const sortMenu = sortGroup.createDiv('sort-menu');
        const sortOptions = [
            { value: 'mtime-desc', text: '修改时间 (新→旧)' },
            { value: 'mtime-asc', text: '修改时间 (旧→新)' },
            { value: 'ctime-desc', text: '创建时间 (新→旧)' },
            { value: 'ctime-asc', text: '创建时间 (旧→新)' },
            { value: 'name-asc', text: '文件名 (A→Z)' },
            { value: 'name-desc', text: '文件名 (Z→A)' }
        ];

        sortOptions.forEach(option => {
            const sortItem = sortMenu.createDiv('sort-item');
            if (option.value === this.currentSort) {
                sortItem.addClass('active');
            }
            sortItem.setText(option.text);
            sortItem.addEventListener('click', () => {
                this.currentSort = option.value;
                this.sortNotes();
                this.displayNotes(cardsContainer, this.currentFilter);
                // 更新选中状态
                sortMenu.querySelectorAll('.sort-item').forEach(item => item.removeClass('active'));
                sortItem.addClass('active');
                // 隐藏菜单
                sortMenu.style.display = 'none';
            });
        });

        // 点击排序按钮显示/隐藏菜单
        sortButton.addEventListener('click', (e) => {
            e.stopPropagation();
            const isVisible = sortMenu.style.display === 'block';
            sortMenu.style.display = isVisible ? 'none' : 'block';
        });

        // 点击其他地方隐藏菜单
        document.addEventListener('click', () => {
            sortMenu.style.display = 'none';
        });

        // 创建卡片容器
        const cardsContainer = container.createDiv('cards-container');
        
        // 设置按钮点击事件
        allButton.onclick = () => {
            this.setActiveButton(allButton);
            this.currentFilter = undefined;
            this.displayNotes(cardsContainer);
        };
        unprocessedButton.onclick = () => {
            this.setActiveButton(unprocessedButton);
            this.currentFilter = false;
            this.displayNotes(cardsContainer, false);
        };
        processedButton.onclick = () => {
            this.setActiveButton(processedButton);
            this.currentFilter = true;
            this.displayNotes(cardsContainer, true);
        };

        // 默认显示未整理笔记
        unprocessedButton.click();
    }

    setActiveButton(activeButton) {
        // 移除所有按钮的活跃状态
        const buttons = this.containerEl.querySelectorAll('.button-container button');
        buttons.forEach(button => button.classList.remove('active'));
        // 添加当前按钮的活跃状态
        activeButton.classList.add('active');
    }

    createNoteCard(container, note) {
        const card = container.createDiv('note-card');
        
        // 添加创建时间
        const timeDiv = card.createDiv('time');
        const date = new Date(note.createdTime);
        timeDiv.setText(date.toLocaleString('zh-CN', {
            year: 'numeric',
            month: '2-digit',
            day: '2-digit',
            hour: '2-digit',
            minute: '2-digit',
            second: '2-digit'
        }));
        
        // 创建按钮容器
        const buttonContainer = card.createDiv('card-buttons');
        
        // 添加状态切换按钮
        const statusButton = buttonContainer.createEl('button', {
            text: note.isProcessed ? '已整理' : '未整理',
            cls: note.isProcessed ? 'processed' : 'unprocessed'
        });
        
        if (!note.isProcessed) {
            statusButton.style.backgroundColor = this.plugin.settings.unprocessedButtonColor;
        }
        
        // 添加打开笔记按钮
        const openButton = buttonContainer.createEl('button', {
            text: '打开笔记',
            cls: 'open-note'
        });

        // 如果存在链接，添加原文链接按钮
        if (note.link) {
            const linkButton = buttonContainer.createEl('button', {
                text: '原文链接',
                cls: 'source-link'
            });
            linkButton.onclick = (e) => {
                e.stopPropagation();
                window.open(note.link, '_blank');
            };
        }

        statusButton.onclick = async (e) => {
            e.stopPropagation();
            try {
                // 读取当前文件内容
                let content = await this.app.vault.read(note.file);
                
                // 获取现有的 frontmatter
                let existingFrontmatter = {};
                if (content.startsWith('---')) {
                    const endOfFrontmatter = content.indexOf('---', 4);
                    if (endOfFrontmatter !== -1) {
                        const frontmatterContent = content.substring(3, endOfFrontmatter);
                        try {
                            existingFrontmatter = obsidian.parseYaml(frontmatterContent);
                        } catch (e) {
                            console.error('解析 frontmatter 失败:', e);
                        }
                        content = content.substring(endOfFrontmatter + 4);
                    }
                }

                // 更新 processed 状态，保留其他属性
                existingFrontmatter.processed = !note.isProcessed;
                
                // 生成新的 frontmatter
                const newFrontmatter = `---\n${obsidian.stringifyYaml(existingFrontmatter)}---\n`;
                
                // 写入新内容
                await this.app.vault.modify(note.file, newFrontmatter + content);
                
                // 更新笔记状态
                note.isProcessed = !note.isProcessed;
                
                // 重新加载笔记列表
                this.notes = await this.plugin.loadNotes();
                
                // 使用当前的过滤器重新显示笔记
                const cardsContainer = this.containerEl.querySelector('.cards-container');
                this.displayNotes(cardsContainer, this.currentFilter);
                
            } catch (error) {
                console.error('更新笔记状态时出错:', error);
                new obsidian.Notice('更新笔记状态失败');
            }
        };

        // 添加笔记内容预览，支持渲染内部链接
        const content = card.createDiv('content');
        content.setAttribute('style', 'user-select: text;');
        
        // 获取正文内容（去除frontmatter）
        let noteContent = note.content;
        if (noteContent.startsWith('---')) {
            const endOfFrontmatter = noteContent.indexOf('---', 4);
            if (endOfFrontmatter !== -1) {
                noteContent = noteContent.substring(endOfFrontmatter + 4);
            }
        }
        
        // 获取第一个分隔符之前的内容
        const separatorIndex = noteContent.indexOf('---');
        if (separatorIndex !== -1) {
            noteContent = noteContent.substring(0, separatorIndex);
        }
        
        // 处理内部链接
        noteContent = this.renderInternalLinks(noteContent.trim());
        content.innerHTML = noteContent;

        // 添加打开笔记事件
        openButton.onclick = (e) => {
            e.stopPropagation();
            this.app.workspace.getLeaf(true).openFile(note.file);
        };

        // 添加笔记标题
        const titleDiv = card.createDiv('note-title');
        titleDiv.setText(note.file.basename);  // 显示文件名作为标题

        // 添加内部链接的点击事件处理
        content.addEventListener('click', (e) => {
            const link = e.target.closest('.internal-link');
            if (link) {
                e.preventDefault();
                e.stopPropagation();
                const fileName = link.getAttribute('data-href');
                // 尝试不同的文件路径组合来查找笔记
                let file = this.app.vault.getAbstractFileByPath(`${fileName}.md`);
                if (!file) {
                    file = this.app.vault.getAbstractFileByPath(fileName);
                }
                if (file) {
                    this.app.workspace.getLeaf(true).openFile(file);
                }
            }
        });

        // 在原文链接后添加标签显示
        const tags = this.app.metadataCache.getFileCache(note.file)?.tags || [];
        if (tags.length > 0) {
            const tagsContainer = card.createDiv('tags-container');
            tags.forEach(tag => {
                const tagEl = tagsContainer.createSpan('tag');
                tagEl.setText(tag.tag);
            });
        }
    }

    displayNotes(container, processed) {
        container.empty();
        let filteredNotes = this.notes;
        if (processed !== undefined) {
            filteredNotes = this.notes.filter(note => note.isProcessed === processed);
        }
        
        if (filteredNotes.length === 0) {
            const emptyMessage = container.createDiv('empty-message');
            emptyMessage.setText('没有符合条件的笔记');
            return;
        }
        
        for (const note of filteredNotes) {
            this.createNoteCard(container, note);
        }
    }

    // 添加新方法来处理内部链接
    renderInternalLinks(text) {
        return text.replace(/\[\[(.*?)\]\]/g, (match, linkText) => {
            const [fileName, displayName] = linkText.split('|');
            const displayText = displayName || fileName;
            // 移除 cursor: pointer 样式
            return `<a class="internal-link" data-href="${fileName}">${displayText}</a>`;
        });
    }

    sortNotes() {
        this.notes.sort((a, b) => {
            const [type, order] = this.currentSort.split('-');
            const isAsc = order === 'asc';
            switch (type) {
                case 'mtime':
                    return isAsc ? 
                        a.file.stat.mtime - b.file.stat.mtime :
                        b.file.stat.mtime - a.file.stat.mtime;
                case 'ctime':
                    return isAsc ? 
                        a.file.stat.ctime - b.file.stat.ctime :
                        b.file.stat.ctime - a.file.stat.ctime;
                case 'name':
                    return isAsc ? 
                        a.file.basename.localeCompare(b.file.basename) :
                        b.file.basename.localeCompare(a.file.basename);
                default:
                    return 0;
            }
        });
    }

    async loadNotes() {
        this.notes = await this.plugin.loadNotes();
        this.sortNotes();
    }
}

module.exports = NoteCardsPlugin; 