// iOS Discord Modded Plugin - DM Message Visual Editor
// Adds functionality to visually edit other users' DM messages client-side
// GitHub URL: https://github.com/yourusername/discord-dm-editor (replace with your repo)

// ============================================
// MAIN PLUGIN CLASS
// ============================================
class DiscordDMEditor {
    constructor() {
        this.name = "DM Editor";
        this.version = "1.0.0";
        this.author = "kettu";
        this.description = "Visually edit DM messages from other users (client-side only)";
        this.enabled = true;
        this.editedMessages = new Map(); // Store edits per message ID
        this.patchId = null;
    }

    // ============================================
    // STARTUP - INITIALIZE PLUGIN
    // ============================================
    start() {
        if (this.patchId) return;
        
        try {
            // Hook into Discord's message rendering pipeline
            this.patchMessageRenderer();
            this.injectEditUI();
            this.patchId = "dm_editor_active";
            console.log(`[${this.name}] Started successfully`);
        } catch (e) {
            console.error(`[${this.name}] Start failed:`, e);
        }
    }

    // ============================================
    // STOP - CLEAN UP
    // ============================================
    stop() {
        if (this.patchId) {
            this.removePatches();
            this.patchId = null;
            console.log(`[${this.name}] Stopped`);
        }
    }

    // ============================================
    // PATCH MESSAGE RENDERER
    // Override message content display
    // ============================================
    patchMessageRenderer() {
        const originalRender = window.DiscordComponents?.Message?.render;
        if (!originalRender) {
            // Fallback: Find message render function in React tree
            this.findAndPatchReactComponent();
            return;
        }

        const self = this;
        window.DiscordComponents.Message.render = function(props) {
            const originalContent = props.content;
            const messageId = props.message?.id;
            
            // Check if this message has an edited version
            if (self.editedMessages.has(messageId)) {
                const edited = self.editedMessages.get(messageId);
                props.content = edited.content;
                props.isEdited = true;
                props.editedTimestamp = Date.now();
            }
            
            return originalRender.call(this, props);
        };
    }

    // ============================================
    // FIND AND PATCH REACT COMPONENT
    // Alternative method for modern Discord versions
    // ============================================
    findAndPatchReactComponent() {
        // Search React Fiber tree for message components
        const appRoot = document.querySelector('#app-mount');
        if (!appRoot) return;

        const fiberKey = Object.keys(appRoot).find(k => k.startsWith('__reactFiber$'));
        if (!fiberKey) return;

        const fiber = appRoot[fiberKey];
        this.traverseAndPatchFiber(fiber);
    }

    traverseAndPatchFiber(fiber) {
        if (!fiber) return;
        
        // Check if this fiber renders message content
        if (fiber.type && typeof fiber.type === 'function') {
            const fnStr = fiber.type.toString();
            if (fnStr.includes('message') && fnStr.includes('content')) {
                this.patchFiberMessage(fiber);
                return;
            }
        }

        // Traverse children
        if (fiber.child) this.traverseAndPatchFiber(fiber.child);
        if (fiber.sibling) this.traverseAndPatchFiber(fiber.sibling);
    }

    patchFiberMessage(fiber) {
        const originalRender = fiber.type.prototype?.render || fiber.type;
        const self = this;
        
        if (typeof originalRender === 'function') {
            fiber.type.prototype.render = function(props) {
                const result = originalRender.call(this, props);
                const messageId = this.props?.message?.id || this.state?.message?.id;
                
                if (self.editedMessages.has(messageId)) {
                    const edited = self.editedMessages.get(messageId);
                    // Override children text nodes
                    if (result?.props?.children) {
                        result.props.children = self.replaceTextNodes(
                            result.props.children,
                            edited.content
                        );
                    }
                }
                return result;
            };
        }
    }

    // ============================================
    // REPLACE TEXT NODES RECURSIVELY
    // ============================================
    replaceTextNodes(node, newText) {
        if (typeof node === 'string') {
            return newText;
        }
        if (Array.isArray(node)) {
            return node.map(child => this.replaceTextNodes(child, newText));
        }
        if (node && typeof node === 'object' && node.props?.children) {
            return {
                ...node,
                props: {
                    ...node.props,
                    children: this.replaceTextNodes(node.props.children, newText)
                }
            };
        }
        return node;
    }

    // ============================================
    // INJECT EDIT UI
    // Add "Edit" button to message context menu
    // ============================================
    injectEditUI() {
        const self = this;
        
        // Wait for Discord's context menu to be available
        this.waitForElement('.message-2CShn3', () => {
            this.addContextMenuItem();
        });

        // Also patch the message hover menu
        this.patchMessageHoverActions();
    }

    addContextMenuItem() {
        const originalMenu = window.DiscordComponents?.ContextMenu?.render;
        if (!originalMenu) return;

        const self = this;
        window.DiscordComponents.ContextMenu.render = function(props) {
            const menuItems = props.items || [];
            
            // Check if this is a message context menu
            if (props.target?.className?.includes('message')) {
                const messageId = props.target?.dataset?.messageId;
                if (messageId) {
                    menuItems.push({
                        label: 'Edit DM (Visual)',
                        action: () => self.showEditDialog(messageId),
                        icon: '✏️'
                    });
                    
                    // Add reset option if already edited
                    if (self.editedMessages.has(messageId)) {
                        menuItems.push({
                            label: 'Reset to Original',
                            action: () => self.resetMessage(messageId),
                            icon: '↩️'
                        });
                    }
                }
            }
            
            return originalMenu.call(this, props);
        };
    }

    // ============================================
    // PATCH MESSAGE HOVER ACTIONS
    // Add edit icon to message hover
    // ============================================
    patchMessageHoverActions() {
        const self = this;
        const style = document.createElement('style');
        style.id = 'dm-editor-styles';
        style.textContent = `
            .dm-editor-edit-btn {
                opacity: 0;
                transition: opacity 0.2s;
                cursor: pointer;
                color: var(--text-muted);
                margin-left: 8px;
                font-size: 14px;
            }
            .message-2CShn3:hover .dm-editor-edit-btn {
                opacity: 1;
            }
            .dm-editor-edit-btn:hover {
                color: var(--text-normal);
            }
            .dm-editor-edited-badge {
                color: var(--brand-experiment);
                font-size: 10px;
                margin-left: 6px;
                font-weight: 600;
                text-transform: uppercase;
            }
        `;
        document.head.appendChild(style);

        // Observe new messages for edit button injection
        const observer = new MutationObserver((mutations) => {
            mutations.forEach((mutation) => {
                mutation.addedNodes.forEach((node) => {
                    if (node.nodeType === 1 && node.matches?.('.message-2CShn3')) {
                        self.addEditButtonToMessage(node);
                    }
                });
            });
        });
        observer.observe(document.body, { childList: true, subtree: true });
    }

    addEditButtonToMessage(messageElement) {
        if (messageElement.querySelector('.dm-editor-edit-btn')) return;
        
        const messageId = messageElement.dataset?.messageId || 
                         messageElement.querySelector('[data-message-id]')?.dataset?.messageId;
        if (!messageId) return;

        const hoverContainer = messageElement.querySelector('.container-2Pjhx-');
        if (!hoverContainer) return;

        const editBtn = document.createElement('span');
        editBtn.className = 'dm-editor-edit-btn';
        editBtn.textContent = '✏️';
        editBtn.title = 'Edit this message visually';
        editBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            this.showEditDialog(messageId);
        });

        hoverContainer.appendChild(editBtn);

        // Add edited badge if message is edited
        if (this.editedMessages.has(messageId)) {
            const badge = document.createElement('span');
            badge.className = 'dm-editor-edited-badge';
            badge.textContent = '(edited)';
            const content = messageElement.querySelector('.messageContent-2qWWxC');
            if (content) {
                content.appendChild(badge);
            }
        }
    }

    // ============================================
    // SHOW EDIT DIALOG
    // Open modal for editing message text
    // ============================================
    showEditDialog(messageId) {
        // Get current content
        let currentContent = this.editedMessages.get(messageId)?.content || '';
        
        // Try to get original from DOM
        if (!currentContent) {
            const messageEl = document.querySelector(`[data-message-id="${messageId}"]`);
            if (messageEl) {
                const contentEl = messageEl.querySelector('.messageContent-2qWWxC');
                if (contentEl) {
                    currentContent = contentEl.textContent.trim();
                }
            }
        }

        // Create modal overlay
        const overlay = document.createElement('div');
        overlay.style.cssText = `
            position: fixed;
            top: 0; left: 0; right: 0; bottom: 0;
            background: rgba(0,0,0,0.7);
            display: flex;
            align-items: center;
            justify-content: center;
            z-index: 999999;
            backdrop-filter: blur(4px);
        `;

        const modal = document.createElement('div');
        modal.style.cssText = `
            background: var(--background-secondary);
            padding: 24px;
            border-radius: 12px;
            max-width: 500px;
            width: 90%;
            box-shadow: 0 8px 32px rgba(0,0,0,0.5);
        `;

        modal.innerHTML = `
            <h3 style="color: var(--header-primary); margin-bottom: 12px;">Edit Message</h3>
            <p style="color: var(--text-muted); font-size: 13px; margin-bottom: 12px;">
                This edit is visual (client-side only). Original message is not modified on Discord servers.
            </p>
            <textarea id="dm-edit-textarea" style="
                width: 100%;
                min-height: 100px;
                background: var(--background-primary);
                border: 1px solid var(--background-modifier-border);
                border-radius: 6px;
                color: var(--text-normal);
                padding: 10px;
                font-size: 14px;
                resize: vertical;
                box-sizing: border-box;
            ">${this.escapeHtml(currentContent)}</textarea>
            <div style="margin-top: 12px; display: flex; gap: 10px; justify-content: flex-end;">
                <button id="dm-edit-cancel" style="
                    padding: 8px 16px;
                    background: var(--background-modifier-hover);
                    border: none;
                    border-radius: 4px;
                    color: var(--text-normal);
                    cursor: pointer;
                ">Cancel</button>
                <button id="dm-edit-save" style="
                    padding: 8px 16px;
                    background: var(--brand-experiment);
                    border: none;
                    border-radius: 4px;
                    color: white;
                    cursor: pointer;
                    font-weight: 600;
                ">Apply Edit</button>
            </div>
        `;

        overlay.appendChild(modal);
        document.body.appendChild(overlay);

        const textarea = modal.querySelector('#dm-edit-textarea');
        const saveBtn = modal.querySelector('#dm-edit-save');
        const cancelBtn = modal.querySelector('#dm-edit-cancel');

        textarea.focus();
        textarea.select();

        const self = this;
        saveBtn.addEventListener('click', () => {
            const newContent = textarea.value.trim();
            if (newContent) {
                self.applyEdit(messageId, newContent);
            }
            overlay.remove();
        });

        cancelBtn.addEventListener('click', () => overlay.remove());
        overlay.addEventListener('click', (e) => {
            if (e.target === overlay) overlay.remove();
        });

        // Close on Escape
        document.addEventListener('keydown', function handler(e) {
            if (e.key === 'Escape') {
                overlay.remove();
                document.removeEventListener('keydown', handler);
            }
        });
    }

    // ============================================
    // APPLY EDIT TO MESSAGE
    // ============================================
    applyEdit(messageId, newContent) {
        this.editedMessages.set(messageId, {
            content: newContent,
            timestamp: Date.now()
        });

        // Force re-render of message
        this.forceMessageRerender(messageId);
    }

    // ============================================
    // RESET MESSAGE TO ORIGINAL
    // ============================================
    resetMessage(messageId) {
        this.editedMessages.delete(messageId);
        this.forceMessageRerender(messageId);
    }

    // ============================================
    // FORCE MESSAGE RERENDER
    // Trigger React re-render for specific message
    // ============================================
    forceMessageRerender(messageId) {
        const messageEl = document.querySelector(`[data-message-id="${messageId}"]`);
        if (!messageEl) return;

        // Find React fiber and trigger update
        const fiberKey = Object.keys(messageEl).find(k => k.startsWith('__reactFiber$'));
        if (fiberKey) {
            const fiber = messageEl[fiberKey];
            if (fiber && fiber.stateNode && fiber.stateNode.forceUpdate) {
                fiber.stateNode.forceUpdate();
                return;
            }
        }

        // Fallback: Clone and replace to force DOM update
        const parent = messageEl.parentNode;
        if (parent) {
            const clone = messageEl.cloneNode(true);
            // Preserve the data-message-id
            clone.dataset.messageId = messageId;
            parent.replaceChild(clone, messageEl);
            // Re-inject edit button
            this.addEditButtonToMessage(clone);
        }
    }

    // ============================================
    // REMOVE ALL PATCHES
    // ============================================
    removePatches() {
        const style = document.getElementById('dm-editor-styles');
        if (style) style.remove();

        // Remove all edit buttons
        document.querySelectorAll('.dm-editor-edit-btn').forEach(el => el.remove());
        document.querySelectorAll('.dm-editor-edited-badge').forEach(el => el.remove());

        // Clear edits
        this.editedMessages.clear();
    }

    // ============================================
    // UTILITY: WAIT FOR ELEMENT
    // ============================================
    waitForElement(selector, callback, timeout = 10000) {
        const startTime = Date.now();
        const check = () => {
            const element = document.querySelector(selector);
            if (element) {
                callback(element);
                return;
            }
            if (Date.now() - startTime > timeout) {
                console.warn(`[${this.name}] Timeout waiting for: ${selector}`);
                return;
            }
            setTimeout(check, 200);
        };
        check();
    }

    // ============================================
    // UTILITY: ESCAPE HTML
    // ============================================
    escapeHtml(text) {
        const div = document.createElement('div');
        div.textContent = text;
        return div.innerHTML;
    }
}

// ============================================
// EXPORT FOR VENCORD/VENDETTA
// ============================================
const plugin = new DiscordDMEditor();

// For Vendetta/Enmity plugin system
export default {
    name: plugin.name,
    version: plugin.version,
    author: plugin.author,
    description: plugin.description,
    start: () => plugin.start(),
    stop: () => plugin.stop(),
    getSettingsPanel: () => {
        const panel = document.createElement('div');
        panel.textContent = 'DM Editor Plugin v1.0.0';
        panel.style.padding = '16px';
        panel.style.color = 'var(--text-normal)';
        return panel;
    }
};

// For direct injection (if no plugin loader)
if (typeof window !== 'undefined') {
    window.DiscordDMEditor = plugin;
    console.log('[DM Editor] Loaded. Type DiscordDMEditor.start() to activate');
}