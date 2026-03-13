import { useState, useEffect } from 'react'
import { Database, Plus, RefreshCw, Trash2, Edit3, ChevronRight, ChevronDown, AlertCircle, ExternalLink, ArrowLeft } from 'lucide-react'
import { Link } from 'react-router-dom'
import { useAdmin } from '../AdminContext'
import {
  listDataSources, createDataSource, updateDataSource, deleteDataSource,
  syncDataSource, syncAllDataSources, getDataSourceItems, getConfig,
} from '../api'

const SOURCE_TYPES = [
  { value: 'jira', label: 'Jira', desc: 'Import issues from Jira project/epic', shared: true },
  { value: 'confluence', label: 'Confluence', desc: 'Import pages from Confluence space', shared: true },
  { value: 'mcp_tools', label: 'MCP Tools', desc: 'Auto-discover tools from MCP server URL (per-environment)', shared: false },
  { value: 'context', label: 'Free Text', desc: 'Add free-text requirements context (per-environment)', shared: false },
]

const SYNC_BADGES = {
  never: { color: 'var(--text-muted)', bg: 'var(--bg-primary)', label: 'Never synced' },
  syncing: { color: 'var(--blue)', bg: '#eff6ff', label: 'Syncing...' },
  synced: { color: 'var(--green)', bg: '#f0fdf4', label: 'Synced' },
  error: { color: 'var(--red)', bg: '#fef2f2', label: 'Error' },
}

function ConfirmModal({ title, message, confirmLabel = 'Confirm', confirmColor = 'var(--red)', onConfirm, onCancel }) {
  return (
    <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.4)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1100 }} onClick={onCancel}>
      <div style={{ background: 'var(--bg-card)', borderRadius: 'var(--radius)', padding: '1.5rem', width: 400, boxShadow: '0 8px 30px rgba(0,0,0,0.15)' }} onClick={e => e.stopPropagation()}>
        <h3 style={{ margin: '0 0 0.5rem', fontSize: '0.9rem' }}>{title}</h3>
        <p style={{ fontSize: '0.78rem', color: 'var(--text-secondary)', margin: '0 0 1rem' }}>{message}</p>
        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '0.5rem' }}>
          <button onClick={onCancel} style={{ fontSize: '0.78rem' }}>Cancel</button>
          <button onClick={onConfirm} style={{ fontSize: '0.78rem', background: confirmColor, color: '#fff', border: 'none', borderRadius: 'var(--radius)', padding: '0.4em 1em', cursor: 'pointer' }}>{confirmLabel}</button>
        </div>
      </div>
    </div>
  )
}

export default function DataSources() {
  const { admin: isAdmin } = useAdmin()
  const [sources, setSources] = useState([])
  const [loading, setLoading] = useState(true)
  const [envKey, setEnvKey] = useState('production')
  const [showModal, setShowModal] = useState(false)
  const [editSource, setEditSource] = useState(null)
  const [expandedId, setExpandedId] = useState(null)
  const [items, setItems] = useState({})
  const [syncing, setSyncing] = useState({})
  const [syncingAll, setSyncingAll] = useState(false)
  const [confirmDel, setConfirmDel] = useState(null)

  useEffect(() => {
    getConfig().then(d => setEnvKey(d.active_env || 'production')).catch(() => {})
  }, [])

  const load = async () => {
    try {
      const data = await listDataSources(envKey)
      setSources(data.sources || [])
    } catch { /* ignore */ }
    setLoading(false)
  }

  useEffect(() => { load() }, [envKey])

  const handleSync = async (id) => {
    setSyncing(p => ({ ...p, [id]: true }))
    try { await syncDataSource(id); await load() } catch { /* ignore */ }
    setSyncing(p => ({ ...p, [id]: false }))
  }

  const handleSyncAll = async () => {
    setSyncingAll(true)
    try { await syncAllDataSources(envKey); await load() } catch { /* ignore */ }
    setSyncingAll(false)
  }

  const handleDelete = async (id) => {
    try { await deleteDataSource(id); setConfirmDel(null); await load() } catch { /* ignore */ }
  }

  const handleToggleEnabled = async (id, currentlyEnabled) => {
    try { await updateDataSource(id, { enabled: !currentlyEnabled }); await load() } catch { /* ignore */ }
  }

  const toggleExpand = async (id) => {
    if (expandedId === id) { setExpandedId(null); return }
    setExpandedId(id)
    if (!items[id]) {
      try {
        const data = await getDataSourceItems(id)
        setItems(p => ({ ...p, [id]: data.items || [] }))
      } catch { /* ignore */ }
    }
  }

  if (loading) return <div className="empty"><span className="spinner" /> Loading data sources...</div>

  return (
    <div>
      <div className="page-header">
        <h2 style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
          <Link to="/test-manager" style={{ color: 'var(--text-muted)', display: 'flex' }}><ArrowLeft size={18} /></Link>
          <Database size={20} /> Data Sources
        </h2>
        <div style={{ display: 'flex', gap: '0.4rem' }}>
          {sources.length > 0 && (
            <button onClick={handleSyncAll} disabled={syncingAll} style={{ fontSize: '0.73rem' }}>
              {syncingAll ? <><span className="spinner" style={{ width: 10, height: 10 }} /> Syncing All...</> : <><RefreshCw size={12} /> Sync All</>}
            </button>
          )}
          {isAdmin && (
            <button className="primary" onClick={() => { setEditSource(null); setShowModal(true) }} style={{ fontSize: '0.73rem' }}>
              <Plus size={12} /> Add Source
            </button>
          )}
        </div>
      </div>

      <div className="card">
        <div style={{ fontSize: '0.78rem', color: 'var(--text-muted)', marginBottom: '0.75rem' }}>
          Configure data sources for test generation. Jira and Confluence sources are <strong>shared</strong> across all environments. MCP Tools and Context are <strong>per-environment</strong>.
        </div>

        {sources.length === 0 ? (
          <div className="empty" style={{ padding: '2rem' }}>
            No data sources configured. Add one to start importing requirements.
          </div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
            {sources.map(src => {
              const badge = SYNC_BADGES[src.sync_status] || SYNC_BADGES.never
              const typeInfo = SOURCE_TYPES.find(t => t.value === src.source_type) || {}
              const expanded = expandedId === src.id
              const srcItems = items[src.id] || []
              return (
                <div key={src.id} style={{ border: '1px solid var(--border)', borderRadius: 'var(--radius)', overflow: 'hidden' }}>
                  <div style={{
                    padding: '0.65rem 0.85rem', display: 'flex', justifyContent: 'space-between', alignItems: 'center',
                    background: expanded ? 'var(--bg-primary)' : 'var(--bg-card)', cursor: 'pointer',
                  }} onClick={() => toggleExpand(src.id)}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', flex: 1 }}>
                      {expanded ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
                      <div style={{ opacity: src.enabled ? 1 : 0.5 }}>
                        <div style={{ fontWeight: 600, fontSize: '0.8rem' }}>{src.name}</div>
                        <div style={{ fontSize: '0.7rem', color: 'var(--text-muted)', display: 'flex', alignItems: 'center', gap: '0.3rem' }}>
                          {typeInfo.label || src.source_type} — {src.item_count || 0} items
                          {src.shared && <span style={{ fontSize: '0.58rem', padding: '0.1em 0.35em', borderRadius: '8px', background: '#f0f0ff', color: 'var(--accent)', fontWeight: 500 }}>Shared</span>}
                        </div>
                      </div>
                    </div>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '0.4rem' }} onClick={e => e.stopPropagation()}>
                      <span style={{
                        fontSize: '0.65rem', padding: '0.15em 0.5em', borderRadius: '10px',
                        background: badge.bg, color: badge.color, fontWeight: 500,
                      }}>{badge.label}</span>
                      {isAdmin && (
                        <button
                          onClick={() => handleToggleEnabled(src.id, src.enabled)}
                          title={src.enabled ? 'Disable' : 'Enable'}
                          style={{
                            fontSize: '0.62rem', padding: '0.15em 0.45em', borderRadius: '10px',
                            border: '1px solid var(--border)', cursor: 'pointer',
                            background: src.enabled ? '#ecfdf5' : '#f5f5f5',
                            color: src.enabled ? 'var(--green)' : 'var(--text-muted)',
                            fontWeight: 500,
                          }}
                        >
                          {src.enabled ? 'Enabled' : 'Disabled'}
                        </button>
                      )}
                      {!isAdmin && !src.enabled && (
                        <span style={{ fontSize: '0.65rem', padding: '0.15em 0.5em', borderRadius: '10px', background: '#f5f5f5', color: 'var(--text-muted)' }}>Disabled</span>
                      )}
                      <button onClick={() => handleSync(src.id)} disabled={syncing[src.id] || !src.enabled} style={{ fontSize: '0.7rem', padding: '0.2em 0.5em', opacity: src.enabled ? 1 : 0.4 }} title="Sync now">
                        {syncing[src.id] ? <span className="spinner" style={{ width: 10, height: 10 }} /> : <RefreshCw size={11} />}
                      </button>
                      {isAdmin && (
                        <>
                          <button onClick={() => { setEditSource(src); setShowModal(true) }} style={{ fontSize: '0.7rem', padding: '0.2em 0.5em' }} title="Edit">
                            <Edit3 size={11} />
                          </button>
                          <button onClick={() => setConfirmDel(src.id)} style={{ fontSize: '0.7rem', padding: '0.2em 0.5em', color: 'var(--red)' }} title="Delete">
                            <Trash2 size={11} />
                          </button>
                        </>
                      )}
                    </div>
                  </div>
                  {expanded && (
                    <div style={{ borderTop: '1px solid var(--border)', padding: '0.5rem 0.85rem', maxHeight: 300, overflow: 'auto' }}>
                      {src.sync_error && (
                        <div style={{ fontSize: '0.72rem', color: 'var(--red)', marginBottom: '0.4rem' }}>
                          <AlertCircle size={11} style={{ verticalAlign: 'middle' }} /> {src.sync_error}
                        </div>
                      )}
                      {src.last_synced_at && (
                        <div style={{ fontSize: '0.68rem', color: 'var(--text-muted)', marginBottom: '0.4rem' }}>
                          Last synced: {new Date(src.last_synced_at + 'Z').toLocaleString()}
                        </div>
                      )}
                      {srcItems.length === 0 ? (
                        <div style={{ fontSize: '0.72rem', color: 'var(--text-muted)', padding: '0.5rem 0' }}>
                          No items yet. Click sync to fetch.
                        </div>
                      ) : (
                        <table style={{ width: '100%', fontSize: '0.72rem', borderCollapse: 'collapse' }}>
                          <thead>
                            <tr style={{ borderBottom: '1px solid var(--border)' }}>
                              <th style={{ textAlign: 'left', padding: '0.3rem 0.4rem', fontWeight: 600 }}>Title</th>
                              <th style={{ textAlign: 'left', padding: '0.3rem 0.4rem', fontWeight: 600, width: 70 }}>Type</th>
                            </tr>
                          </thead>
                          <tbody>
                            {srcItems.slice(0, 50).map(item => (
                              <tr key={item.id} style={{ borderBottom: '1px solid var(--border)' }}>
                                <td style={{ padding: '0.3rem 0.4rem' }}>
                                  {item.external_url ? (
                                    <a href={item.external_url} target="_blank" rel="noopener noreferrer" style={{ color: 'var(--accent)', textDecoration: 'none' }}>
                                      {item.title} <ExternalLink size={9} style={{ verticalAlign: 'middle' }} />
                                    </a>
                                  ) : item.title}
                                </td>
                                <td style={{ padding: '0.3rem 0.4rem' }}>
                                  <span style={{ fontSize: '0.65rem', padding: '0.1em 0.4em', borderRadius: '8px', background: 'var(--bg-primary)', color: 'var(--text-secondary)' }}>
                                    {item.item_type}
                                  </span>
                                </td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      )}
                      {srcItems.length > 50 && (
                        <div style={{ fontSize: '0.68rem', color: 'var(--text-muted)', padding: '0.3rem 0' }}>
                          Showing 50 of {srcItems.length} items
                        </div>
                      )}
                    </div>
                  )}
                </div>
              )
            })}
          </div>
        )}
      </div>

      {showModal && (
        <DataSourceModal
          source={editSource}
          envKey={envKey}
          onClose={() => { setShowModal(false); setEditSource(null) }}
          onSaved={() => { setShowModal(false); setEditSource(null); load() }}
        />
      )}

      {confirmDel && (
        <ConfirmModal
          title="Delete Data Source"
          message="Delete this data source and all its items? This cannot be undone."
          confirmLabel="Delete"
          onConfirm={() => handleDelete(confirmDel)}
          onCancel={() => setConfirmDel(null)}
        />
      )}
    </div>
  )
}

function DataSourceModal({ source, envKey, onClose, onSaved }) {
  const [name, setName] = useState(source?.name || '')
  const [sourceType, setSourceType] = useState(source?.source_type || 'jira')
  const [config, setConfig] = useState(source?.config || {})
  const [enabled, setEnabled] = useState(source?.enabled !== false)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState(null)

  const handleSave = async () => {
    if (!name.trim()) { setError('Name is required'); return }
    setSaving(true)
    setError(null)
    try {
      if (source) {
        await updateDataSource(source.id, { name, source_type: sourceType, config, enabled })
      } else {
        await createDataSource({ env_key: envKey, source_type: sourceType, name, config })
      }
      onSaved()
    } catch (err) {
      setError(err.message)
    }
    setSaving(false)
  }

  const updateCfg = (key, val) => setConfig(c => ({ ...c, [key]: val }))

  return (
    <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.4)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000 }} onClick={onClose}>
      <div style={{ background: 'var(--bg-card)', borderRadius: 'var(--radius)', padding: '1.5rem', width: 500, maxHeight: '80vh', overflow: 'auto', boxShadow: '0 8px 30px rgba(0,0,0,0.15)' }} onClick={e => e.stopPropagation()}>
        <h3 style={{ margin: '0 0 1rem' }}>{source ? 'Edit Data Source' : 'Add Data Source'}</h3>

        <div style={{ marginBottom: '0.75rem' }}>
          <label style={{ fontSize: '0.75rem', fontWeight: 600, display: 'block', marginBottom: '0.25rem' }}>Name</label>
          <input value={name} onChange={e => setName(e.target.value)} placeholder="e.g. Sprint 1 Requirements" style={{ width: '100%' }} />
        </div>

        <div style={{ marginBottom: '0.75rem' }}>
          <label style={{ fontSize: '0.75rem', fontWeight: 600, display: 'block', marginBottom: '0.25rem' }}>Source Type</label>
          <div style={{ display: 'flex', gap: '0.4rem', flexWrap: 'wrap' }}>
            {SOURCE_TYPES.map(t => (
              <button key={t.value} onClick={() => { setSourceType(t.value); setConfig({}) }}
                style={{
                  fontSize: '0.73rem', padding: '0.3em 0.7em', borderRadius: '6px',
                  border: sourceType === t.value ? '2px solid var(--accent)' : '1px solid var(--border)',
                  background: sourceType === t.value ? '#f0f0ff' : 'var(--bg-card)',
                  color: sourceType === t.value ? 'var(--accent)' : 'var(--text-secondary)',
                  cursor: 'pointer', fontWeight: sourceType === t.value ? 600 : 400,
                }}>
                {t.label}
              </button>
            ))}
          </div>
          <div style={{ fontSize: '0.68rem', color: 'var(--text-muted)', marginTop: '0.25rem' }}>
            {SOURCE_TYPES.find(t => t.value === sourceType)?.desc}
          </div>
        </div>

        {sourceType === 'jira' && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
            <div>
              <label style={{ fontSize: '0.73rem', fontWeight: 500 }}>Project Key</label>
              <input value={config.project_key || ''} onChange={e => updateCfg('project_key', e.target.value)} placeholder="QUAL" style={{ width: '100%' }} />
            </div>
            <div>
              <label style={{ fontSize: '0.73rem', fontWeight: 500 }}>Epic Keys (comma-separated)</label>
              <input value={(config.epic_keys || []).join(', ')} onChange={e => updateCfg('epic_keys', e.target.value.split(',').map(s => s.trim()).filter(Boolean))} placeholder="QUAL-179, QUAL-180" style={{ width: '100%' }} />
            </div>
            <div>
              <label style={{ fontSize: '0.73rem', fontWeight: 500 }}>JQL Filter (overrides above)</label>
              <input value={config.jql_filter || ''} onChange={e => updateCfg('jql_filter', e.target.value)} placeholder="project = QUAL AND type = Story" style={{ width: '100%' }} />
            </div>
            <label style={{ fontSize: '0.72rem', display: 'flex', alignItems: 'center', gap: '0.3rem' }}>
              <input type="checkbox" checked={config.include_subtasks !== false} onChange={e => updateCfg('include_subtasks', e.target.checked)} />
              Include sub-tasks
            </label>
            <div style={{ padding: '0.5rem', background: 'var(--bg-primary)', borderRadius: '6px', fontSize: '0.72rem' }}>
              <div style={{ fontWeight: 600, marginBottom: '0.3rem', color: 'var(--text-secondary)' }}>
                Credentials (optional — falls back to Bug Settings, then .env)
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.3rem' }}>
                <div>
                  <label style={{ fontSize: '0.68rem' }}>Username / Email</label>
                  <input value={config.username || ''} onChange={e => updateCfg('username', e.target.value)} placeholder="Leave blank for Bug Settings" style={{ width: '100%', fontSize: '0.72rem' }} />
                </div>
                <div>
                  <label style={{ fontSize: '0.68rem' }}>API Token</label>
                  <input type="password" value={config.api_token || ''} onChange={e => updateCfg('api_token', e.target.value)} placeholder="Leave blank for Bug Settings" style={{ width: '100%', fontSize: '0.72rem' }} />
                </div>
              </div>
            </div>
          </div>
        )}

        {sourceType === 'confluence' && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
            <div>
              <label style={{ fontSize: '0.73rem', fontWeight: 500 }}>Space Key</label>
              <input value={config.space_key || ''} onChange={e => updateCfg('space_key', e.target.value)} placeholder="TEAM" style={{ width: '100%' }} />
            </div>
            <div>
              <label style={{ fontSize: '0.73rem', fontWeight: 500 }}>Page IDs (comma-separated, optional)</label>
              <input value={(config.page_ids || []).join(', ')} onChange={e => updateCfg('page_ids', e.target.value.split(',').map(s => s.trim()).filter(Boolean))} placeholder="12345, 67890" style={{ width: '100%' }} />
            </div>
            <label style={{ fontSize: '0.72rem', display: 'flex', alignItems: 'center', gap: '0.3rem' }}>
              <input type="checkbox" checked={config.include_children || false} onChange={e => updateCfg('include_children', e.target.checked)} />
              Include child pages
            </label>
            <div style={{ padding: '0.5rem', background: 'var(--bg-primary)', borderRadius: '6px', fontSize: '0.72rem' }}>
              <div style={{ fontWeight: 600, marginBottom: '0.3rem', color: 'var(--text-secondary)' }}>
                Credentials (optional — falls back to Bug Settings, then .env)
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.3rem' }}>
                <div>
                  <label style={{ fontSize: '0.68rem' }}>Username / Email</label>
                  <input value={config.username || ''} onChange={e => updateCfg('username', e.target.value)} placeholder="Leave blank for Bug Settings" style={{ width: '100%', fontSize: '0.72rem' }} />
                </div>
                <div>
                  <label style={{ fontSize: '0.68rem' }}>API Token</label>
                  <input type="password" value={config.api_token || ''} onChange={e => updateCfg('api_token', e.target.value)} placeholder="Leave blank for Bug Settings" style={{ width: '100%', fontSize: '0.72rem' }} />
                </div>
              </div>
            </div>
          </div>
        )}

        {sourceType === 'mcp_tools' && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
            <div>
              <label style={{ fontSize: '0.73rem', fontWeight: 500 }}>MCP Server URL (auto-discover tools)</label>
              <input value={config.url || ''} onChange={e => updateCfg('url', e.target.value)} placeholder="https://your-mcp-server.com" style={{ width: '100%' }} />
              <div style={{ fontSize: '0.68rem', color: 'var(--text-muted)', marginTop: '0.2rem' }}>
                Tools are fetched via MCP JSON-RPC protocol using environment Bearer token (from env credentials). Leave empty to use manual JSON below.
              </div>
            </div>
            <div>
              <label style={{ fontSize: '0.73rem', fontWeight: 500 }}>Manual Tools JSON (fallback if no URL)</label>
              <textarea
                value={JSON.stringify(config.tools || [], null, 2)}
                onChange={e => { try { updateCfg('tools', JSON.parse(e.target.value)) } catch {} }}
                placeholder={'[\n  {"name": "create_test", "description": "Creates a test case", "parameters": {}}\n]'}
                rows={5} style={{ width: '100%', fontFamily: 'monospace', fontSize: '0.72rem' }}
              />
              <div style={{ fontSize: '0.68rem', color: 'var(--text-muted)', marginTop: '0.2rem' }}>
                {config.url ? 'Ignored when URL is set — tools are auto-discovered on sync.' : 'Array of tool objects with name, description, and parameters fields.'}
              </div>
            </div>
          </div>
        )}

        {sourceType === 'context' && (
          <div>
            <label style={{ fontSize: '0.73rem', fontWeight: 500 }}>Context Text</label>
            <textarea
              value={config.text || ''}
              onChange={e => updateCfg('text', e.target.value)}
              placeholder="Enter free-text requirements, context, or instructions for test generation..."
              rows={6} style={{ width: '100%', fontSize: '0.78rem' }}
            />
          </div>
        )}

        {source && (
          <div style={{ marginTop: '0.75rem' }}>
            <label style={{ fontSize: '0.72rem', display: 'flex', alignItems: 'center', gap: '0.3rem' }}>
              <input type="checkbox" checked={enabled} onChange={e => setEnabled(e.target.checked)} />
              Enabled (included in sync-all)
            </label>
          </div>
        )}

        {error && <div style={{ fontSize: '0.73rem', color: 'var(--red)', marginTop: '0.5rem' }}>{error}</div>}

        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '0.5rem', marginTop: '1rem' }}>
          <button onClick={onClose}>Cancel</button>
          <button className="primary" onClick={handleSave} disabled={saving}>
            {saving ? 'Saving...' : source ? 'Update' : 'Create'}
          </button>
        </div>
      </div>
    </div>
  )
}
