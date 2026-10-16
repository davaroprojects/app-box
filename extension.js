import St from 'gi://St';
import Clutter from 'gi://Clutter';
import Shell from 'gi://Shell';
import Meta from 'gi://Meta';
import GObject from 'gi://GObject';
import Gio from 'gi://Gio';

import {Extension} from 'resource:///org/gnome/shell/extensions/extension.js';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';

const AppBox = GObject.registerClass({
    GTypeName: 'AppBox',
    Signals: {
        'app-launched': {},
    },
}, class AppBox extends St.Widget {
    _init() {
        super._init({
            style_class: 'app-box',
            layout_manager: new Clutter.BoxLayout({
                orientation: Clutter.Orientation.VERTICAL,
                spacing: 16,
            }),
            reactive: true,
            can_focus: true,
            style: 'background-color: rgba(24, 24, 24, 0.96); border-radius: 18px; padding: 24px; border: 1px solid rgba(255, 255, 255, 0.1);',
        });

        // Buscador
        this._searchEntry = new St.Entry({
            style_class: 'app-box-search',
            hint_text: 'Buscar aplicaciones…',
            can_focus: true,
            x_expand: true,
            style: 'font-size: 16px; padding: 10px 14px; border-radius: 10px; background-color: rgba(255, 255, 255, 0.08); color: white;',
        });
        this.add_child(this._searchEntry);

        this._searchEntry.clutter_text.connect('text-changed', () => {
            this._filterApps(this._searchEntry.get_text());
        });

        // Enter: abre la primera aplicación visible
        this._searchEntry.clutter_text.connect('activate', () => {
            const first = this._items.find(item => item.button.visible);
            if (first)
                this._launchApp(first.app);
        });

        // Escape: cierra el lanzador
        this._searchEntry.clutter_text.connect('key-press-event', (actor, event) => {
            if (event.get_key_symbol() === Clutter.KEY_Escape) {
                this.emit('app-launched');
                return Clutter.EVENT_STOP;
            }
            return Clutter.EVENT_PROPAGATE;
        });

        // Scroll vertical
        this._scroll = new St.ScrollView({
            style_class: 'vfade',
            x_expand: true,
            y_expand: true,
            hscrollbar_policy: St.PolicyType.NEVER,
            vscrollbar_policy: St.PolicyType.AUTOMATIC,
        });

        // Rejilla de 6 columnas
        this._grid = new St.Viewport({
            layout_manager: new Clutter.GridLayout({
                column_spacing: 14,
                row_spacing: 16,
                orientation: Clutter.Orientation.VERTICAL,
            }),
            x_expand: true,
        });

        this._scroll.set_child(this._grid);
        this.add_child(this._scroll);

        this._items = [];
        this._loadApps();
    }

    _loadApps() {
        const appSystem = Shell.AppSystem.get_default();
        const installed = appSystem.get_installed()
            .filter(app => {
                if (typeof app.should_show === 'function')
                    return app.should_show();
                if (app.app_info && typeof app.app_info.should_show === 'function')
                    return app.app_info.should_show();
                return true;
            })
            .sort((a, b) => {
                const nameA = a.get_name ? a.get_name() : (a.app_info?.get_name() ?? '');
                const nameB = b.get_name ? b.get_name() : (b.app_info?.get_name() ?? '');
                return nameA.localeCompare(nameB, undefined, {sensitivity: 'base'});
            });

        const COLUMNS = 6;
        let col = 0;
        let row = 0;

        for (const app of installed) {
            const appName = app.get_name ? app.get_name() : (app.app_info?.get_name() ?? 'App');

            let icon = null;
            try {
                if (typeof app.create_icon_texture === 'function')
                    icon = app.create_icon_texture(64);
            } catch (e) {
                icon = null;
            }

            if (!icon) {
                const gicon = app.get_icon ? app.get_icon() : (app.app_info?.get_icon() ?? null);
                icon = new St.Icon({
                    gicon: gicon || Gio.ThemedIcon.new('application-x-executable'),
                    icon_size: 64,
                });
            }

            icon.x_align = Clutter.ActorAlign.CENTER;

            const label = new St.Label({
                text: appName,
                style_class: 'app-box-label',
                x_align: Clutter.ActorAlign.CENTER,
                style: 'text-align: center; color: #f0f0f0; font-size: 13px; margin-top: 4px;',
            });
            label.clutter_text.set_line_wrap(true);
            label.clutter_text.set_ellipsize(3);

            const content = new St.Widget({
                layout_manager: new Clutter.BoxLayout({
                    orientation: Clutter.Orientation.VERTICAL,
                    spacing: 4,
                }),
                x_align: Clutter.ActorAlign.CENTER,
                width: 120,
            });
            content.add_child(icon);
            content.add_child(label);

            const button = new St.Button({
                child: content,
                style_class: 'app-box-button',
                reactive: true,
                can_focus: true,
                track_hover: true,
                style: 'padding: 10px 4px; border-radius: 12px;',
            });

            button.connect('clicked', () => {
                this._launchApp(app);
            });

            this._grid.layout_manager.attach(button, col, row, 1, 1);

            this._items.push({
                app,
                button,
                name: appName.toLowerCase(),
            });

            col++;
            if (col >= COLUMNS) {
                col = 0;
                row++;
            }
        }
    }

    _launchApp(app) {
        this.emit('app-launched');

        try {
            if (typeof app.launch === 'function') {
                app.launch([], null);
                return;
            }

            const info = app.app_info ?? (app.get_app_info ? app.get_app_info() : null);
            if (info && typeof info.launch === 'function') {
                info.launch([], null);
                return;
            }

            if (typeof app.open_new_window === 'function') {
                app.open_new_window(-1);
            } else if (typeof app.activate === 'function') {
                app.activate();
            }
        } catch (e) {
            console.error(`[AppBox] Error al iniciar aplicación: ${e}`);
        }
    }

    _filterApps(query) {
        const q = (query || '').toLowerCase().trim();
        const COLUMNS = 6;
        let col = 0;
        let row = 0;

        for (const item of this._items) {
            const matches = !q || item.name.includes(q);
            item.button.visible = matches;

            if (matches) {
                const layout = this._grid.layout_manager;
                layout.child_set_property(this._grid, item.button, 'left-attach', col);
                layout.child_set_property(this._grid, item.button, 'top-attach', row);

                col++;
                if (col >= COLUMNS) {
                    col = 0;
                    row++;
                }
            }
        }
    }

    open() {
        this._searchEntry.set_text('');
        this._filterApps('');
        this._searchEntry.grab_key_focus();
    }
});

export default class AppBoxExtension extends Extension {
    enable() {
        this._overlay = null;
        this._appBox = null;
        this._settings = this.getSettings();

        // 1. Manejo automático de conflictos con el atajo de GNOME
        this._shellSettings = new Gio.Settings({schema_id: 'org.gnome.shell.keybindings'});
        this._originalShellBinding = this._shellSettings.get_strv('toggle-application-view');

        // Si GNOME tiene asignado Super+A, se remueve temporalmente
        if (this._originalShellBinding.includes('<Super>a')) {
            const filteredBindings = this._originalShellBinding.filter(k => k !== '<Super>a');
            this._shellSettings.set_strv('toggle-application-view', filteredBindings);
        }

        // 2. Registro nativo del keybinding de la extensión
        Main.wm.addKeybinding(
            'toggle-app-box',
            this._settings,
            Meta.KeyBindingFlags.IGNORE_AUTOREPEAT,
            Shell.ActionMode.NORMAL | Shell.ActionMode.OVERVIEW,
            () => this._toggle()
        );
    }

    disable() {
        // Eliminar el keybinding del compositor
        Main.wm.removeKeybinding('toggle-app-box');

        // Restaurar el atajo nativo de GNOME exactamente como estaba
        if (this._shellSettings && this._originalShellBinding) {
            this._shellSettings.set_strv('toggle-application-view', this._originalShellBinding);
            this._shellSettings = null;
            this._originalShellBinding = null;
        }

        this._close();
        this._settings = null;
    }

    _toggle() {
        if (this._overlay)
            this._close();
        else
            this._open();
    }

    _open() {
        if (this._overlay)
            return;

        const monitor = Main.layoutManager.primaryMonitor;

        this._overlay = new St.Button({
            style: 'background-color: rgba(0, 0, 0, 0.55);',
            reactive: true,
            can_focus: true,
            x: 0,
            y: 0,
            width: global.stage.width,
            height: global.stage.height,
        });

        this._appBox = new AppBox();
        this._appBox.connect('app-launched', () => this._close());
        this._appBox.set_size(920, 620);
        this._appBox.set_position(
            Math.round(monitor.x + (monitor.width - 920) / 2),
            Math.round(monitor.y + (monitor.height - 620) / 2)
        );

        // Clic fuera cierra el diálogo
        this._overlay.connect('clicked', (actor) => {
            if (actor === this._overlay)
                this._close();
        });

        // Escape cierra el diálogo
        this._overlay.connect('key-press-event', (actor, event) => {
            if (event.get_key_symbol() === Clutter.KEY_Escape) {
                this._close();
                return Clutter.EVENT_STOP;
            }
            return Clutter.EVENT_PROPAGATE;
        });

        Main.layoutManager.uiGroup.add_child(this._overlay);
        Main.layoutManager.uiGroup.add_child(this._appBox);

        this._appBox.open();
    }

    _close() {
        if (this._appBox) {
            this._appBox.destroy();
            this._appBox = null;
        }

        if (this._overlay) {
            this._overlay.destroy();
            this._overlay = null;
        }
    }
}
