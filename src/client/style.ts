/** Scoped plugin surfaces. All DSH tokens below exist in 0.2.1-rc.2. */
export const CSS = `
.pd-next-detail{border:1px solid var(--pd-border);border-radius:14px;padding:16px;background:var(--pd-surface)}.pd-next-detail p{line-height:1.6}.pd-evidence-text p{white-space:pre-wrap;overflow-wrap:anywhere;line-height:1.7;margin:0 0 16px}.pd-evidence-text{max-height:520px;overflow:auto;padding:4px}.pd-criterion-result{display:block;border-left:3px solid var(--pd-accent);padding:10px;margin:8px 0}.pd-image-evidence{margin:12px 0;min-width:0}.pd-image-evidence img{max-width:100%;max-height:260px;object-fit:contain}.pd-image-evidence code{display:block;overflow-wrap:anywhere}.pd-image-preview img{max-width:100%;height:auto}.pd-criterion-input{display:flex;gap:8px;margin:8px 0}.pd-criterion-input input{flex:1;min-width:0}

.perse-dashboard{
 --pd-bg:var(--dsw-alias-bg-base,#f5f7fa);--pd-surface:var(--dsw-alias-bg-layer-1,#fff);--pd-text:var(--dsw-alias-label-primary,#18202b);--pd-muted:var(--dsw-alias-label-secondary,#667181);--pd-border:var(--dsw-alias-border-l2,#dce1e8);--pd-hover:var(--dsw-alias-interactive-bg-hover,#edf0f5);--pd-accent:#f0b03a;--pd-on-accent:#211704;--pd-success:#28ad79;--pd-danger:#df5c67;
 height:100%;min-height:0;min-width:0;overflow:auto;overscroll-behavior:contain;padding:24px;box-sizing:border-box;background:var(--pd-bg);color:var(--pd-text);font:13px/1.5 -apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;isolation:isolate;container-type:inline-size;
}
.perse-dashboard *{box-sizing:border-box}
.perse-dashboard button,.perse-dashboard input,.perse-dashboard textarea,.perse-dashboard select{font:inherit;color:inherit;border:1px solid var(--pd-border);border-radius:9px;background:var(--pd-surface);padding:8px 11px;line-height:1.45;max-width:100%;min-width:0;box-shadow:none}
.perse-dashboard button{cursor:pointer;font-weight:500;transition:border-color .15s,box-shadow .15s}
.perse-dashboard button:hover{background:var(--pd-hover);border-color:color-mix(in srgb,var(--pd-text) 25%,var(--pd-border))}
.perse-dashboard button:disabled{opacity:.45;cursor:not-allowed}
.perse-dashboard :is(button,input,textarea,select,summary):focus-visible{outline:2px solid var(--pd-accent);outline-offset:3px}
.perse-dashboard input::placeholder,.perse-dashboard textarea::placeholder{color:var(--pd-muted)}
.perse-dashboard input[type=checkbox]{width:16px;height:16px;min-width:16px;margin:2px 0 0;accent-color:var(--pd-accent);padding:0;cursor:pointer}
.perse-dashboard .pd-primary{background:var(--pd-accent);border-color:var(--pd-accent);color:var(--pd-on-accent);font-weight:650}
.perse-dashboard .pd-primary:hover{background:color-mix(in srgb,var(--pd-accent) 86%,white)}
.perse-dashboard .pd-danger{color:var(--pd-danger);border-color:color-mix(in srgb,var(--pd-danger) 40%,var(--pd-border))}
.perse-dashboard h1,.perse-dashboard h2,.perse-dashboard h3,.perse-dashboard p{margin-top:0}
.pd-header{display:flex;align-items:center;justify-content:space-between;gap:20px;margin-bottom:20px}
.pd-eyebrow{font-size:10px;font-weight:650;letter-spacing:.14em;color:var(--pd-muted)}
.pd-header h1{font-size:25px;font-weight:650;line-height:1.35;letter-spacing:-.6px;margin:4px 0}
.pd-muted{color:var(--pd-muted);font-size:12px;line-height:1.6}
.pd-header p{margin-bottom:0}.pd-header-actions{display:flex;align-items:center;gap:16px;flex-shrink:0}
.pd-host{font-size:11px;color:var(--pd-muted);display:inline-flex;align-items:center;gap:7px}
.pd-dot{display:inline-block;width:7px;height:7px;flex-shrink:0;border-radius:50%;background:var(--pd-muted)}
.pd-dot.is-live,.pd-status-icon.is-live{background:var(--pd-success);box-shadow:0 0 0 3px color-mix(in srgb,var(--pd-success) 12%,transparent)}
.pd-stats{display:grid;grid-template-columns:repeat(5,minmax(0,1fr));gap:12px;margin-bottom:18px}
.pd-stat{border:1px solid var(--pd-border);border-radius:16px;padding:14px 17px;background:var(--pd-surface);box-shadow:0 2px 5px #00000004;min-width:0}
.pd-stat>div{display:flex;align-items:center;justify-content:space-between;gap:12px;font-size:11px;font-weight:500;color:var(--pd-muted)}
.pd-stat strong{display:block;font-size:27px;line-height:1.25;font-weight:650;font-variant-numeric:tabular-nums;letter-spacing:-.7px;margin:8px 0 0;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.pd-stat-icon{color:var(--pd-accent);font-size:17px;font-weight:400}
.pd-toolbar{display:flex;gap:10px;align-items:center;flex-wrap:wrap;margin:0 0 14px;min-width:0}
.pd-segments{display:flex;border:1px solid var(--pd-border);padding:3px;border-radius:10px;background:var(--pd-surface);gap:2px;flex-shrink:0}
.pd-segments button{border:0;background:transparent;padding:6px 11px;color:var(--pd-muted);border-radius:7px;font-size:12px}
.pd-segments button[aria-pressed=true]{background:var(--pd-hover);color:var(--pd-text);box-shadow:0 1px 3px #00000010}
.pd-toolbar>select{max-width:220px;min-width:145px}
.pd-search{flex:1;min-width:150px;display:flex;align-items:center;border:1px solid var(--pd-border);background:var(--pd-surface);border-radius:9px;padding-left:12px;color:var(--pd-muted)}
.pd-search input[type=search]{width:100%;border:0;background:transparent;outline-offset:0}
.pd-check{display:flex;align-items:flex-start;gap:10px;line-height:1.6;margin:12px 0;font-size:13px;overflow-wrap:anywhere}
.pd-filter-check{margin:0;white-space:nowrap;font-size:12px}
.pd-automation{border:1px solid var(--pd-border);border-radius:14px;background:var(--pd-surface);display:flex;align-items:center;justify-content:space-between;gap:16px;padding:13px 16px;margin:0 0 20px;min-width:0}
.pd-automation-summary{display:flex;align-items:center;gap:12px;min-width:0}.pd-automation-summary strong{font-size:12px;font-weight:600}.pd-automation-summary p{margin:2px 0 0;font-size:11px}
.pd-status-icon{display:flex;align-items:center;justify-content:center;width:30px;height:30px;border-radius:9px;color:var(--pd-muted);background:var(--pd-hover);font-size:19px;flex-shrink:0}
.pd-status-icon.is-live{color:#fff}.pd-automation-actions{display:flex;align-items:center;gap:8px;flex-shrink:0;flex-wrap:wrap}.pd-automation-actions button{font-size:12px;padding:7px 11px}
.pd-budget{display:flex;gap:7px;align-items:center;font-size:11px;color:var(--pd-muted)}.pd-budget input{width:60px;padding:6px;color:var(--pd-text);text-align:center;font-variant-numeric:tabular-nums}
.pd-budget input[aria-invalid=true]{border-color:var(--pd-danger)}
.pd-layout{min-width:0;width:100%}.pd-columns{display:grid;grid-template-columns:repeat(7,minmax(184px,1fr));gap:10px;overflow-x:auto;overscroll-behavior-x:contain;padding:1px 1px 12px;align-items:start;max-width:100%;scrollbar-width:thin}
.pd-column{--stage:#8793a5;border:1px solid var(--pd-border);border-radius:14px;background:color-mix(in srgb,var(--pd-text) 2%,var(--pd-bg));min-height:310px;max-height:min(65vh,760px);display:flex;flex-direction:column;overflow:hidden;padding:11px;min-width:0}
.pd-column[data-status=triage]{--stage:#a78bfa}.pd-column[data-status=needs-info]{--stage:#e1a44c}.pd-column[data-status=todo]{--stage:#8793a5}.pd-column[data-status=in-progress]{--stage:#61a4e8}.pd-column[data-status=blocked]{--stage:#e2717c}.pd-column[data-status=in-review]{--stage:#c5a052}.pd-column[data-status=done]{--stage:#37b78d}
.pd-column h2{display:flex;align-items:center;justify-content:space-between;gap:8px;font-size:11px;font-weight:650;margin:0 0 13px;line-height:1.4;flex-shrink:0}.pd-column h2>span:first-child{display:flex;align-items:center;gap:7px}.pd-column .pd-dot{width:6px;height:6px;background:var(--stage)}
.pd-count{font-size:10px;padding:1px 6px;border-radius:5px;background:var(--pd-hover);color:var(--pd-muted);font-variant-numeric:tabular-nums}
.pd-column-cards{overflow-y:auto;min-height:0;scrollbar-width:thin}.pd-column-empty{color:color-mix(in srgb,var(--pd-muted) 40%,transparent);text-align:center;margin:45px 0;font-size:14px}
.perse-dashboard .pd-card{display:block;width:100%;text-align:left;border:1px solid var(--pd-border);border-radius:12px;background:var(--pd-surface);margin:0 0 9px;padding:12px;min-width:0;box-shadow:0 2px 5px #00000006;font-weight:400}
.perse-dashboard .pd-card:hover{border-color:color-mix(in srgb,var(--pd-accent) 65%,var(--pd-border));box-shadow:0 4px 14px #0000000b;background:var(--pd-surface)}
.pd-card[aria-pressed=true]{outline:2px solid var(--pd-accent);outline-offset:-1px}
.pd-card-meta{display:flex;align-items:center;justify-content:space-between;gap:8px;font-size:10px;color:var(--pd-muted)}.pd-card-meta code{font:10px ui-monospace,SFMono-Regular,monospace;color:var(--pd-muted)}
.pd-priority{font-size:10px;font-weight:600}.pd-priority.priority-2{color:var(--pd-danger)}
.pd-card strong{display:-webkit-box;-webkit-line-clamp:3;-webkit-box-orient:vertical;overflow:hidden;font-size:13px;font-weight:600;line-height:1.55;overflow-wrap:anywhere;margin:10px 0 6px}
.pd-card-description{display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden;color:var(--pd-muted);font-size:11px;line-height:1.55;overflow-wrap:anywhere;min-height:32px}
.pd-card-tags{display:flex;flex-wrap:wrap;gap:5px;margin:11px 0}.pd-card small{max-width:calc(100% - 35px);overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-size:10px}
.pd-badge{display:inline-flex;align-items:center;border:1px solid var(--pd-border);border-radius:6px;background:color-mix(in srgb,var(--pd-text) 3%,transparent);padding:2px 6px;font-size:10px;white-space:nowrap;color:var(--pd-muted);max-width:100%}
.pd-progress{display:block;height:3px;border-radius:9px;overflow:hidden;background:var(--pd-hover);margin-bottom:10px}.pd-progress>span{display:block;height:100%;background:var(--stage,var(--pd-success));border-radius:inherit}
.pd-scroll-hint{font-size:10px;color:var(--pd-muted);margin:0 0 4px}
.pd-empty{text-align:center;padding:38px 20px;color:var(--pd-muted);font-size:12px}.pd-empty svg{width:25px;height:25px;opacity:.65}.pd-empty h3{font-size:15px;color:var(--pd-text);margin:8px 0}.pd-empty p{margin-bottom:14px}
.pd-table-wrap{border:1px solid var(--pd-border);border-radius:14px;background:var(--pd-surface);max-width:100%;overflow:auto}
.pd-list{width:100%;border-collapse:collapse;font-size:12px}.pd-list th{font-size:10px;color:var(--pd-muted);font-weight:600;text-align:left;background:color-mix(in srgb,var(--pd-text) 2%,transparent)}
.pd-list th,.pd-list td{padding:13px 16px;border-bottom:1px solid var(--pd-border);overflow-wrap:anywhere}.pd-list tbody tr:last-child td{border-bottom:0}.pd-list tbody tr:hover{background:color-mix(in srgb,var(--pd-text) 2%,transparent)}.pd-list td:first-child{min-width:220px;max-width:420px}.pd-list td:last-child button{white-space:nowrap}
.perse-dashboard .pd-text-button{border:0;background:transparent;display:block;padding:0;text-align:left;color:var(--pd-text);font-weight:550}.pd-text-button+small{display:block;margin-top:3px}
.pd-banner{border:1px solid color-mix(in srgb,var(--pd-danger) 45%,var(--pd-border));background:color-mix(in srgb,var(--pd-danger) 6%,var(--pd-surface));border-radius:10px;padding:10px 13px;font-size:12px;margin:10px 0;overflow-wrap:anywhere}
.pd-footer{display:flex;justify-content:space-between;align-items:center;gap:12px;font-size:10px;color:var(--pd-muted);margin:19px 0 2px;border-top:1px solid var(--pd-border);padding-top:13px}.pd-footer>span:first-child{display:flex;align-items:center;gap:7px}.pd-footer .pd-dot{width:5px;height:5px}
/* Dialogs use the browser top layer, without modifying the DSH shell. */
.perse-dashboard .pd-dialog{color:var(--pd-text);background:var(--pd-surface);border:1px solid var(--pd-border);border-radius:20px;padding:0;width:min(1000px,calc(100vw - 48px));max-width:calc(100vw - 48px);height:min(820px,calc(100dvh - 48px));max-height:calc(100dvh - 48px);margin:auto;overflow:hidden;box-shadow:0 24px 90px #0000004a}
.perse-dashboard .pd-dialog[open]{display:flex;flex-direction:column}.perse-dashboard .pd-dialog:not([open]){display:none}.pd-dialog::backdrop{background:#080b1275;backdrop-filter:blur(4px)}
.pd-dialog-header{display:flex;justify-content:space-between;align-items:flex-start;gap:20px;padding:20px 24px 17px;border-bottom:1px solid var(--pd-border);flex-shrink:0}.pd-dialog-header>div{min-width:0}
.pd-dialog-header h2{font-size:19px;font-weight:650;letter-spacing:-.3px;line-height:1.45;margin:4px 0;overflow-wrap:anywhere;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden}.pd-dialog-header p{margin:3px 0 0;font-size:11px}
.perse-dashboard .pd-icon-button{width:32px;height:32px;padding:0;border-radius:9px;flex-shrink:0;font-size:22px;line-height:1;display:grid;place-items:center;background:transparent;color:var(--pd-muted)}
.pd-dialog-body{padding:20px 24px;min-height:0;flex:1;overflow-y:auto;overscroll-behavior:contain;overflow-wrap:anywhere;scrollbar-width:thin}
.pd-dialog-footer{border-top:1px solid var(--pd-border);padding:13px 24px;background:var(--pd-surface);flex-shrink:0;max-height:160px;overflow:auto}.pd-dialog-footer>.pd-actions{margin:0;justify-content:flex-end}.pd-dialog-footer button{font-size:12px}
.pd-detail-tabs{display:flex;gap:18px;position:sticky;top:-20px;z-index:2;background:var(--pd-surface);padding-top:2px;margin:0 0 20px;border-bottom:1px solid var(--pd-border);overflow-x:auto;scrollbar-width:none}
.perse-dashboard .pd-detail-tabs button{border:0;border-radius:0;padding:10px 0;background:transparent;color:var(--pd-muted);white-space:nowrap;border-bottom:2px solid transparent;font-size:12px}
.pd-detail-tabs button[aria-selected=true]{color:var(--pd-text);border-bottom-color:var(--pd-accent)}
.pd-dialog [role=tabpanel][hidden]{display:none}.pd-dialog [role=tabpanel]{min-width:0}.pd-dialog h3{font-size:13px;font-weight:650;margin:18px 0 11px}.pd-dialog section p,.pd-dialog li{line-height:1.75;font-size:12px}.pd-dialog li{margin:7px 0}.pd-dialog section[aria-label]{border:1px solid var(--pd-border);border-radius:12px;padding:2px 16px 12px;margin-bottom:14px}
.pd-section{padding:0 0 15px;margin-bottom:16px;border-bottom:1px solid var(--pd-border)}.pd-section:last-child{margin-bottom:0;border-bottom:0}.pd-section h3:first-child{margin-top:0}
.pd-phase-grid{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:10px;margin-bottom:22px}.pd-phase-card{display:flex;flex-direction:column;gap:7px;border:1px solid var(--pd-border);background:color-mix(in srgb,var(--pd-text) 2%,var(--pd-surface));padding:12px;border-radius:12px;min-width:0}.pd-phase-card strong{font-size:11px;font-weight:550;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.pd-phase-card button{font-size:10px;padding:5px 8px;align-self:flex-start}
.pd-receipt{display:flex;align-items:center;gap:12px;border:1px solid color-mix(in srgb,var(--pd-success) 35%,var(--pd-border));background:color-mix(in srgb,var(--pd-success) 5%,var(--pd-surface));border-radius:12px;padding:12px 14px;margin-bottom:14px}.pd-receipt strong{font-size:12px}.pd-receipt p{font-size:10px;color:var(--pd-muted);margin:3px 0 0}
.pd-field{display:grid;gap:6px;margin:13px 0;font-size:12px;color:var(--pd-muted);min-width:0}.pd-field input,.pd-field textarea,.pd-field select{width:100%;color:var(--pd-text)}.pd-field textarea{min-height:95px;resize:vertical;font-size:12px;line-height:1.7;max-height:330px}.pd-field input[type=number]{max-width:100px}.pd-check{color:var(--pd-text)}
/* Chip radio groups reuse the segmented-control look with wrapping for dynamic lists. */
.pd-chips{display:flex;flex-wrap:wrap;align-content:flex-start;gap:4px;padding:3px;border:1px solid var(--pd-border);border-radius:10px;background:var(--pd-surface);min-width:0;max-width:100%;max-height:170px;overflow:auto;scrollbar-width:thin}
.pd-chip{position:relative;display:inline-flex;max-width:100%;min-width:0}
.pd-chip input{position:absolute;inset:0;width:100%;height:100%;margin:0;padding:0;border:0;opacity:0;cursor:pointer;border-radius:inherit}
.pd-chip>span{padding:6px 11px;border-radius:7px;font-size:12px;line-height:1.45;color:var(--pd-muted);cursor:pointer;overflow-wrap:anywhere;border:1px solid transparent;min-width:0}
.pd-chip:hover>span{background:var(--pd-hover)}
.pd-chip:has(input:checked)>span{background:var(--pd-hover);color:var(--pd-text);font-weight:550;box-shadow:0 1px 3px #00000010}
.pd-chip:has(input:disabled){opacity:.45}
.pd-chip:has(input:disabled)>span{cursor:not-allowed}
.pd-chip:has(input:disabled){pointer-events:none}
.pd-actions{display:flex;gap:8px;flex-wrap:wrap;margin-top:16px;align-items:center}
.pd-detail pre{white-space:pre-wrap;overflow-wrap:anywhere;word-break:break-word;font:11px/1.7 ui-monospace,SFMono-Regular,monospace;background:color-mix(in srgb,var(--pd-text) 3%,var(--pd-surface));padding:12px;border-radius:9px;border:1px solid var(--pd-border);max-height:320px;overflow:auto}
.pd-detail details,.pd-create details{border:1px solid var(--pd-border);border-radius:11px;padding:12px;margin:12px 0}.pd-detail summary,.pd-create summary{font-size:12px;font-weight:550;cursor:pointer;color:var(--pd-text)}
.pd-properties-grid{display:grid;grid-template-columns:1fr 1fr;gap:0 20px}.pd-properties-grid>p{grid-column:1/-1}.pd-rule{display:grid;grid-template-columns:100px 1fr;gap:0 14px;border:1px solid var(--pd-border);background:color-mix(in srgb,var(--pd-text) 2%,var(--pd-surface));border-radius:12px;padding:12px 15px;margin:12px 0}.pd-rule>.pd-rule-wide{grid-column:1/-1}.pd-rule>button{grid-column:1/-1;justify-self:start}
.pd-audit{position:relative;font-size:11px;color:var(--pd-muted);border-left:2px solid var(--pd-border);padding:0 0 20px 18px;margin-left:4px;line-height:1.8;overflow-wrap:anywhere}.pd-audit:before{content:'';position:absolute;left:-5px;top:5px;width:8px;height:8px;background:var(--pd-accent);border-radius:50%;border:2px solid var(--pd-surface)}
.perse-dashboard .pd-create-dialog{width:min(780px,calc(100vw - 48px))}.pd-create{max-width:none;margin:0;display:grid;grid-template-columns:1fr 1fr;gap:0 20px}.pd-create>.pd-span,.pd-create>.pd-policy,.pd-create>p,.pd-create>.pd-actions{grid-column:1/-1}.pd-create>.pd-actions{position:sticky;bottom:-20px;background:var(--pd-surface);padding:16px 0 0;margin:14px 0 0;justify-content:flex-end;border-top:1px solid var(--pd-border)}
.perse-dashboard .pd-confirm-dialog{width:min(420px,calc(100vw - 32px));height:auto}.pd-confirm-dialog .pd-dialog-body{padding-top:10px;padding-bottom:10px}.pd-confirm-dialog .pd-dialog-footer{display:flex;gap:8px;justify-content:flex-end}
@container(max-width:1000px){.pd-automation{align-items:flex-start;flex-direction:column;gap:10px}.pd-automation-actions{width:100%;justify-content:flex-end}.pd-header-actions .pd-host{display:none}}
@container(max-width:650px){.pd-stats{grid-template-columns:repeat(2,minmax(0,1fr))}.pd-header{gap:10px;align-items:flex-start}.pd-header h1{font-size:22px}.pd-header p{max-width:220px}.pd-header-actions button{font-size:11px;padding:8px}.pd-toolbar>select{flex:1;max-width:none}.pd-segments{width:100%}.pd-segments button{flex:1}.pd-search{flex-basis:100%;order:3}.pd-automation-actions{justify-content:flex-start}.pd-automation-actions button{flex:1}.pd-budget{width:100%}.pd-list td,.pd-list th{padding:10px}.pd-header .pd-eyebrow{font-size:9px}}
@media(max-width:640px){.perse-dashboard{padding:14px}.perse-dashboard .pd-dialog{width:calc(100vw - 16px);max-width:calc(100vw - 16px);height:calc(100dvh - 16px);max-height:calc(100dvh - 16px);border-radius:15px}.pd-dialog-header{padding:15px 16px}.pd-dialog-header h2{font-size:17px}.pd-dialog-body{padding:16px}.pd-dialog-footer{padding:12px 16px}.pd-detail-tabs{top:-16px;gap:15px}.pd-phase-grid{grid-template-columns:1fr}.pd-phase-card{display:grid;grid-template-columns:1fr auto}.pd-phase-card strong{grid-column:1}.pd-phase-card button{grid-column:2;grid-row:1/3;align-self:center}.pd-properties-grid,.pd-create{grid-template-columns:1fr}.pd-create>*{grid-column:1!important}.pd-create>.pd-actions{bottom:-16px}.pd-rule{grid-template-columns:1fr}.pd-rule>*{grid-column:1!important}.pd-dialog-footer .pd-actions>button{flex:1}.pd-detail pre{font-size:10px}.pd-create-dialog .pd-dialog-header p{display:none}}
.pd-stat.is-attention{border-color:var(--pd-accent);background:color-mix(in srgb,var(--pd-accent) 7%,var(--pd-surface))}.pd-attention{border:1px solid var(--pd-accent);background:color-mix(in srgb,var(--pd-accent) 9%,var(--pd-surface));padding:14px 16px;border-radius:12px;margin-bottom:16px;overflow-wrap:anywhere}.pd-attention>strong{color:var(--pd-text);font-size:14px}.pd-attention p{font-size:12px;margin:5px 0}.pd-attention .pd-actions{margin-top:9px}.pd-attention button{font-size:12px;text-align:left}.perse-dashboard .pd-card.is-attention{border-color:var(--pd-accent);transition:none}.pd-badge.is-attention,.pd-status-icon.is-attention{color:var(--pd-on-accent);background:var(--pd-accent)}
.pd-permissions{display:flex;justify-content:space-between;align-items:center;gap:15px;border:1px solid var(--pd-border);border-radius:12px;padding:11px 15px;margin:-8px 0 18px;background:var(--pd-surface)}.pd-permissions strong{font-size:12px}.pd-permissions p{margin:3px 0 0;font-size:11px}.pd-permissions button{flex-shrink:0;font-size:12px}.pd-permission-options{border:1px solid var(--pd-border);border-radius:12px;margin:18px 0;padding:10px 16px}.pd-permission-options legend{font-size:12px;color:var(--pd-muted)}.pd-permission-options input[type=radio]{width:17px;height:17px;accent-color:var(--pd-accent);flex-shrink:0;margin:3px 0 0;padding:0}.pd-permission-options small{display:block;font-size:12px;color:var(--pd-muted);margin:5px 0}.perse-dashboard .pd-permission-dialog{width:min(650px,calc(100vw - 48px));height:auto;max-height:calc(100dvh - 48px)}.pd-permission-dialog .pd-dialog-footer{display:flex;justify-content:flex-end;gap:8px}.pd-permission-dialog .pd-dialog-body>p{font-size:12px}
@container(max-width:650px){.pd-permissions{align-items:flex-start;flex-direction:column}.pd-attention .pd-actions>button{width:100%}}
@media(prefers-reduced-motion:reduce){.perse-dashboard *{transition:none!important;scroll-behavior:auto!important}}
`
