import { useState, useEffect, useMemo } from 'react'
import { FolderTree, FolderOpen, FolderPlus, FileText, Plus, Trash2, Edit3, Check, X, ChevronRight, ChevronDown, Search, Filter, Move, ArrowUpRight, Play, Copy, Package, Loader, AlertCircle, RefreshCw } from 'lucide-react'
import { useAdmin } from '../AdminContext'
import {
  listTestFolders, createTestFolder, updateTestFolder, deleteTestFolder,
  listTestSuites, createTestSuite, updateTestSuite, deleteTestSuite,
  getSuiteCases, addCasesToSuite, removeCasesFromSuite, runSuite,
  listTestCases, createTestCaseManual, updateTestCase, deleteTestCase,
  bulkMoveCases, bulkApproveTestCases, bulkDeleteTestCases,
  importBuiltinScenarios, getCaseRunHistory,
} from '../api'

const MODE_COLORS = { fixed: 'var(--green)', hybrid: 'var(--orange)', explore: 'var(--accent)', fire: 'var(--red)' }
const PRIORITY_COLORS = { high: 'var(--red)', medium: 'var(--yellow)', low: 'var(--text-muted)' }
const STATUS_COLORS = { draft: 'var(--blue)', approved: 'var(--green)', rejected: 'var(--red)', archived: 'var(--text-muted)' }

function Badge({ color, children }) {
  return <span style={{ fontSize: '0.63rem', padding: '0.1em 0.45em', borderRadius: '10px', background: `${color}18`, color, fontWeight: 500 }}>{children}</span>
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

// ── Folder Tree Component ──────────────────────────────────────

function FolderTreePanel({ folders, selectedFolder, onSelect, onCreateFolder, onDeleteFolder, onRenameFolder, isAdmin, suites, onRefresh }) {
  const [expanded, setExpanded] = useState(new Set())
  const [newFolderParent, setNewFolderParent] = useState(null)
  const [newFolderName, setNewFolderName] = useState('')
  const [renamingId, setRenamingId] = useState(null)
  const [renameVal, setRenameVal] = useState('')

  const tree = useMemo(() => buildTree(folders), [folders])
  const totalCases = folders.reduce((s, f) => s + (f.case_count || 0), 0)

  function buildTree(flat) {
    const map = {}
    const roots = []
    flat.forEach(f => { map[f.id] = { ...f, children: [] } })
    flat.forEach(f => {
      if (f.parent_id && map[f.parent_id]) map[f.parent_id].children.push(map[f.id])
      else roots.push(map[f.id])
    })
    return roots
  }

  const toggle = (id) => setExpanded(p => { const n = new Set(p); n.has(id) ? n.delete(id) : n.add(id); return n })

  const handleCreateFolder = () => {
    if (!newFolderName.trim()) return
    onCreateFolder(newFolderName.trim(), newFolderParent)
    setNewFolderName('')
    setNewFolderParent(null)
  }

  const handleRename = (id) => {
    if (!renameVal.trim()) { setRenamingId(null); return }
    onRenameFolder(id, renameVal.trim())
    setRenamingId(null)
  }

  const renderNode = (node, depth = 0) => {
    const isSelected = selectedFolder === node.id
    const isExpanded = expanded.has(node.id)
    const hasChildren = node.children.length > 0

    return (
      <div key={node.id}>
        <div
          style={{
            display: 'flex', alignItems: 'center', gap: '0.3rem', padding: '0.3rem 0.5rem',
            paddingLeft: `${0.5 + depth * 0.8}rem`, cursor: 'pointer', fontSize: '0.75rem',
            background: isSelected ? 'var(--accent)10' : 'transparent',
            borderLeft: isSelected ? '2px solid var(--accent)' : '2px solid transparent',
            borderRadius: '0 4px 4px 0',
          }}
          onClick={() => onSelect(node.id)}
        >
          {hasChildren ? (
            <span onClick={e => { e.stopPropagation(); toggle(node.id) }} style={{ cursor: 'pointer', display: 'flex' }}>
              {isExpanded ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
            </span>
          ) : <span style={{ width: 12 }} />}
          {isExpanded ? <FolderOpen size={13} style={{ color: 'var(--accent)' }} /> : <FolderTree size={13} style={{ color: 'var(--text-muted)' }} />}
          {renamingId === node.id ? (
            <input value={renameVal} onChange={e => setRenameVal(e.target.value)}
              onKeyDown={e => { if (e.key === 'Enter') handleRename(node.id); if (e.key === 'Escape') setRenamingId(null) }}
              onBlur={() => handleRename(node.id)}
              style={{ fontSize: '0.73rem', flex: 1, padding: '0.1em 0.3em' }} autoFocus />
          ) : (
            <span style={{ flex: 1, fontWeight: isSelected ? 600 : 400, color: isSelected ? 'var(--accent)' : 'var(--text-primary)' }}>
              {node.name}
            </span>
          )}
          <span style={{ fontSize: '0.63rem', color: 'var(--text-muted)' }}>{node.case_count || 0}</span>
          {isAdmin && renamingId !== node.id && (
            <span style={{ display: 'flex', gap: '0.1rem', opacity: 0.5 }} onClick={e => e.stopPropagation()}>
              <button onClick={() => { setNewFolderParent(node.id); setExpanded(p => new Set([...p, node.id])) }} title="Add subfolder" style={{ fontSize: '0.6rem', padding: '0.1em', background: 'none', border: 'none', cursor: 'pointer' }}><FolderPlus size={10} /></button>
              <button onClick={() => { setRenamingId(node.id); setRenameVal(node.name) }} title="Rename" style={{ fontSize: '0.6rem', padding: '0.1em', background: 'none', border: 'none', cursor: 'pointer' }}><Edit3 size={10} /></button>
              <button onClick={() => onDeleteFolder(node.id)} title="Delete" style={{ fontSize: '0.6rem', padding: '0.1em', background: 'none', border: 'none', cursor: 'pointer', color: 'var(--red)' }}><Trash2 size={10} /></button>
            </span>
          )}
        </div>
        {isExpanded && node.children.map(c => renderNode(c, depth + 1))}
      </div>
    )
  }

  return (
    <div style={{ borderRight: '1px solid var(--border)', minWidth: 220, maxWidth: 260, overflow: 'auto' }}>
      <div style={{ padding: '0.6rem 0.6rem 0.3rem', fontSize: '0.7rem', fontWeight: 700, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
        Folders
      </div>

      {/* Virtual nodes */}
      <div
        style={{
          display: 'flex', alignItems: 'center', gap: '0.3rem', padding: '0.3rem 0.5rem',
          cursor: 'pointer', fontSize: '0.75rem',
          background: selectedFolder === null ? 'var(--accent)10' : 'transparent',
          borderLeft: selectedFolder === null ? '2px solid var(--accent)' : '2px solid transparent',
          borderRadius: '0 4px 4px 0',
        }}
        onClick={() => onSelect(null)}
      >
        <span style={{ width: 12 }} /><FileText size={13} style={{ color: 'var(--text-muted)' }} />
        <span style={{ flex: 1, fontWeight: selectedFolder === null ? 600 : 400 }}>All Cases</span>
        <span style={{ fontSize: '0.63rem', color: 'var(--text-muted)' }}>{totalCases}</span>
      </div>
      <div
        style={{
          display: 'flex', alignItems: 'center', gap: '0.3rem', padding: '0.3rem 0.5rem',
          cursor: 'pointer', fontSize: '0.75rem',
          background: selectedFolder === '__unorganized' ? 'var(--accent)10' : 'transparent',
          borderLeft: selectedFolder === '__unorganized' ? '2px solid var(--accent)' : '2px solid transparent',
          borderRadius: '0 4px 4px 0',
        }}
        onClick={() => onSelect('__unorganized')}
      >
        <span style={{ width: 12 }} /><FileText size={13} style={{ color: 'var(--text-muted)' }} />
        <span style={{ flex: 1, fontWeight: selectedFolder === '__unorganized' ? 600 : 400 }}>Unorganized</span>
      </div>

      <div style={{ borderTop: '1px solid var(--border)', margin: '0.3rem 0' }} />
      {tree.map(n => renderNode(n))}

      {/* New folder input */}
      {isAdmin && (
        <div style={{ padding: '0.4rem 0.5rem' }}>
          {newFolderParent !== null || newFolderName ? (
            <div style={{ display: 'flex', gap: '0.2rem' }}>
              <input value={newFolderName} onChange={e => setNewFolderName(e.target.value)}
                onKeyDown={e => { if (e.key === 'Enter') handleCreateFolder(); if (e.key === 'Escape') { setNewFolderName(''); setNewFolderParent(null) } }}
                placeholder={newFolderParent ? 'Subfolder name...' : 'New folder...'}
                style={{ flex: 1, fontSize: '0.7rem', padding: '0.2em 0.4em' }} autoFocus />
              <button onClick={handleCreateFolder} style={{ fontSize: '0.6rem', padding: '0.15em 0.3em' }}><Check size={10} /></button>
              <button onClick={() => { setNewFolderName(''); setNewFolderParent(null) }} style={{ fontSize: '0.6rem', padding: '0.15em 0.3em' }}><X size={10} /></button>
            </div>
          ) : (
            <button onClick={() => setNewFolderParent(undefined)} style={{ fontSize: '0.68rem', width: '100%', padding: '0.25em 0.5em', display: 'flex', alignItems: 'center', gap: '0.3rem' }}>
              <FolderPlus size={11} /> New Folder
            </button>
          )}
        </div>
      )}

      {/* Suites section */}
      <div style={{ borderTop: '1px solid var(--border)', margin: '0.3rem 0' }} />
      <div style={{ padding: '0.4rem 0.6rem', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <span style={{ fontSize: '0.7rem', fontWeight: 700, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.05em' }}>Suites</span>
      </div>
      <SuiteSidebar suites={suites} isAdmin={isAdmin} onRefresh={onRefresh} />
    </div>
  )
}

// ── Suite Sidebar ──────────────────────────────────────────────

function SuiteSidebar({ suites, isAdmin, onRefresh }) {
  const [creating, setCreating] = useState(false)
  const [newName, setNewName] = useState('')
  const [newType, setNewType] = useState('manual')
  const [running, setRunning] = useState(null)
  const [confirmDel, setConfirmDel] = useState(null)
  const navigate = useState(null) // handled via window.location

  const handleCreate = async () => {
    if (!newName.trim()) return
    try {
      await createTestSuite({ name: newName.trim(), suite_type: newType })
      setNewName('')
      setCreating(false)
      onRefresh()
    } catch { /* ignore */ }
  }

  const handleDelete = async (id) => {
    try { await deleteTestSuite(id); setConfirmDel(null); onRefresh() } catch { /* ignore */ }
  }

  const handleRun = async (id) => {
    setRunning(id)
    try {
      const res = await runSuite(id)
      window.location.href = `/matches/${res.match_id}`
    } catch { /* ignore */ }
    setRunning(null)
  }

  return (
    <div style={{ fontSize: '0.72rem' }}>
      {suites.length === 0 && !creating && (
        <div style={{ padding: '0.3rem 0.6rem', color: 'var(--text-muted)', fontSize: '0.68rem' }}>No suites yet.</div>
      )}
      {suites.map(s => (
        <div key={s.id} style={{
          display: 'flex', alignItems: 'center', gap: '0.25rem', padding: '0.25rem 0.6rem',
          borderRadius: '0 4px 4px 0', fontSize: '0.72rem',
        }}>
          <Package size={12} style={{ color: s.suite_type === 'smart' ? 'var(--orange)' : 'var(--accent)', flexShrink: 0 }} />
          <span style={{ flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={s.name}>{s.name}</span>
          <span style={{ fontSize: '0.6rem', color: 'var(--text-muted)', flexShrink: 0 }}>{s.case_count || 0}</span>
          {isAdmin && (
            <>
              <button onClick={() => handleRun(s.id)} disabled={running === s.id}
                title="Run suite" style={{ background: 'none', border: 'none', cursor: 'pointer', padding: '0.1rem', color: 'var(--green)', display: 'flex' }}>
                {running === s.id ? <Loader size={10} className="spin" /> : <Play size={10} />}
              </button>
              <button onClick={() => setConfirmDel(s.id)}
                title="Delete suite" style={{ background: 'none', border: 'none', cursor: 'pointer', padding: '0.1rem', color: 'var(--text-muted)', display: 'flex' }}>
                <Trash2 size={9} />
              </button>
            </>
          )}
        </div>
      ))}
      {isAdmin && !creating && (
        <button onClick={() => setCreating(true)} style={{ fontSize: '0.68rem', width: 'calc(100% - 1rem)', margin: '0.25rem 0.5rem', padding: '0.25em 0.5em', display: 'flex', alignItems: 'center', gap: '0.2rem' }}>
          <Plus size={10} /> New Suite
        </button>
      )}
      {creating && (
        <div style={{ padding: '0.3rem 0.6rem', display: 'flex', flexDirection: 'column', gap: '0.2rem' }}>
          <input value={newName} onChange={e => setNewName(e.target.value)} placeholder="Suite name" autoFocus
            onKeyDown={e => { if (e.key === 'Enter') handleCreate(); if (e.key === 'Escape') setCreating(false) }}
            style={{ fontSize: '0.7rem', width: '100%' }} />
          <div style={{ display: 'flex', gap: '0.2rem' }}>
            <select value={newType} onChange={e => setNewType(e.target.value)} style={{ fontSize: '0.65rem', flex: 1 }}>
              <option value="manual">Manual</option>
              <option value="smart">Smart</option>
            </select>
            <button onClick={handleCreate} style={{ fontSize: '0.6rem', padding: '0.15em 0.4em', color: 'var(--green)' }}><Check size={10} /></button>
            <button onClick={() => setCreating(false)} style={{ fontSize: '0.6rem', padding: '0.15em 0.4em' }}><X size={10} /></button>
          </div>
        </div>
      )}
      {confirmDel && (
        <ConfirmModal
          title="Delete Suite"
          message="Delete this suite? Test cases will not be affected."
          confirmLabel="Delete"
          onConfirm={() => handleDelete(confirmDel)}
          onCancel={() => setConfirmDel(null)}
        />
      )}
    </div>
  )
}

// ── Main Component ─────────────────────────────────────────────

export default function TestCaseManager() {
  const { admin: isAdmin } = useAdmin()
  const [folders, setFolders] = useState([])
  const [cases, setCases] = useState([])
  const [suites, setSuites] = useState([])
  const [loading, setLoading] = useState(true)
  const [selectedFolder, setSelectedFolder] = useState(null) // null = all, '__unorganized' = no folder, string = folder id
  const [selectedCases, setSelectedCases] = useState(new Set())
  const [searchQuery, setSearchQuery] = useState('')
  const [filterMode, setFilterMode] = useState('')
  const [filterStatus, setFilterStatus] = useState('')
  const [filterPriority, setFilterPriority] = useState('')
  const [showCreateCase, setShowCreateCase] = useState(false)
  const [showCreateSuite, setShowCreateSuite] = useState(false)
  const [confirmModal, setConfirmModal] = useState(null)
  const [viewCase, setViewCase] = useState(null)
  const [tab, setTab] = useState('cases') // cases, suites
  const [sortBy, setSortBy] = useState('name')
  const [sortDir, setSortDir] = useState('asc')

  const load = async () => {
    try {
      const [fd, cd, sd] = await Promise.all([listTestFolders(), listTestCases(), listTestSuites()])
      setFolders(fd.folders || [])
      setCases(cd.cases || [])
      setSuites(sd.suites || [])
    } catch { /* ignore */ }
    setLoading(false)
  }

  useEffect(() => { load() }, [])

  const toggleSort = (col) => {
    if (sortBy === col) setSortDir(d => d === 'asc' ? 'desc' : 'asc')
    else { setSortBy(col); setSortDir('asc') }
  }

  // Filter + sort cases
  const filteredCases = useMemo(() => {
    let result = cases
    if (selectedFolder === '__unorganized') result = result.filter(c => !c.folder_id)
    else if (selectedFolder && selectedFolder !== null) result = result.filter(c => c.folder_id === selectedFolder)
    if (searchQuery) {
      const q = searchQuery.toLowerCase()
      result = result.filter(c => c.name.toLowerCase().includes(q) || (c.description || '').toLowerCase().includes(q))
    }
    if (filterMode) result = result.filter(c => c.mode === filterMode)
    if (filterStatus) result = result.filter(c => c.status === filterStatus)
    if (filterPriority) result = result.filter(c => c.priority === filterPriority)
    // Sort
    const dir = sortDir === 'asc' ? 1 : -1
    const priorityOrder = { high: 0, medium: 1, low: 2 }
    const statusOrder = { approved: 0, draft: 1, rejected: 2, archived: 3 }
    result = [...result].sort((a, b) => {
      let cmp = 0
      if (sortBy === 'name') cmp = a.name.localeCompare(b.name)
      else if (sortBy === 'mode') cmp = (a.mode || '').localeCompare(b.mode || '')
      else if (sortBy === 'priority') cmp = (priorityOrder[a.priority] ?? 9) - (priorityOrder[b.priority] ?? 9)
      else if (sortBy === 'status') cmp = (statusOrder[a.status] ?? 9) - (statusOrder[b.status] ?? 9)
      else if (sortBy === 'score') cmp = (a.last_run_score ?? -1) - (b.last_run_score ?? -1)
      else if (sortBy === 'runs') cmp = (a.run_count || 0) - (b.run_count || 0)
      return cmp * dir
    })
    return result
  }, [cases, selectedFolder, searchQuery, filterMode, filterStatus, filterPriority, sortBy, sortDir])

  const handleCreateFolder = async (name, parentId) => {
    try {
      await createTestFolder({ name, parent_id: parentId || null })
      await load()
    } catch { /* ignore */ }
  }

  const handleDeleteFolder = (folderId) => {
    setConfirmModal({
      title: 'Delete Folder', message: 'Cases in this folder will be moved to Unorganized. Continue?',
      confirmLabel: 'Delete', onCancel: () => setConfirmModal(null),
      onConfirm: async () => { setConfirmModal(null); try { await deleteTestFolder(folderId); if (selectedFolder === folderId) setSelectedFolder(null); await load() } catch {} },
    })
  }

  const handleRenameFolder = async (id, name) => {
    try { await updateTestFolder(id, { name }); await load() } catch {}
  }

  const handleBulkApprove = async () => {
    if (selectedCases.size === 0) return
    try { await bulkApproveTestCases([...selectedCases]); setSelectedCases(new Set()); await load() } catch {}
  }

  const handleBulkDelete = () => {
    if (selectedCases.size === 0) return
    setConfirmModal({
      title: 'Delete Cases', message: `Delete ${selectedCases.size} selected case(s)? This cannot be undone.`,
      confirmLabel: `Delete ${selectedCases.size}`, onCancel: () => setConfirmModal(null),
      onConfirm: async () => { setConfirmModal(null); try { await bulkDeleteTestCases([...selectedCases]); setSelectedCases(new Set()); await load() } catch {} },
    })
  }

  const handleBulkMove = async (folderId) => {
    if (selectedCases.size === 0) return
    try { await bulkMoveCases([...selectedCases], folderId || null); setSelectedCases(new Set()); await load() } catch {}
  }

  const handleDeleteCase = (caseId) => {
    setConfirmModal({
      title: 'Delete Case', message: 'Are you sure? This cannot be undone.',
      confirmLabel: 'Delete', onCancel: () => setConfirmModal(null),
      onConfirm: async () => { setConfirmModal(null); try { await deleteTestCase(caseId); setSelectedCases(p => { const n = new Set(p); n.delete(caseId); return n }); await load() } catch {} },
    })
  }

  const handleImportBuiltins = async () => {
    try {
      const result = await importBuiltinScenarios(selectedFolder !== '__unorganized' ? selectedFolder : null)
      await load()
      setConfirmModal({
        title: 'Imported', message: `${result.count} builtin scenarios imported.`,
        confirmLabel: 'OK', confirmColor: 'var(--green)',
        onConfirm: () => setConfirmModal(null), onCancel: () => setConfirmModal(null),
      })
    } catch (err) {
      setConfirmModal({
        title: 'Error', message: err.message,
        confirmLabel: 'OK', confirmColor: 'var(--red)',
        onConfirm: () => setConfirmModal(null), onCancel: () => setConfirmModal(null),
      })
    }
  }

  const toggleSelect = (id) => setSelectedCases(p => { const n = new Set(p); n.has(id) ? n.delete(id) : n.add(id); return n })
  const selectAll = () => setSelectedCases(new Set(filteredCases.map(c => c.id)))
  const clearSelection = () => setSelectedCases(new Set())

  if (loading) return <div className="empty"><span className="spinner" /> Loading test manager...</div>

  return (
    <div>
      <div className="page-header">
        <h2><FolderTree size={20} /> Test Manager</h2>
        <div style={{ display: 'flex', gap: '0.4rem' }}>
          {isAdmin && (
            <>
              <button onClick={handleImportBuiltins} title="Import builtin scenarios" style={{ fontSize: '0.73rem' }}>
                <RefreshCw size={12} style={{ verticalAlign: 'middle', marginRight: '0.2rem' }} /> Import Builtins
              </button>
              <button className="primary" onClick={() => setShowCreateCase(true)}>
                <Plus size={14} style={{ verticalAlign: 'middle', marginRight: '0.2rem' }} /> New Case
              </button>
            </>
          )}
        </div>
      </div>

      <div className="card" style={{ padding: 0, display: 'flex', height: 'calc(100vh - 180px)', overflow: 'hidden' }}>
        {/* Left: Folder Tree */}
        <FolderTreePanel
          folders={folders}
          selectedFolder={selectedFolder}
          onSelect={setSelectedFolder}
          onCreateFolder={handleCreateFolder}
          onDeleteFolder={handleDeleteFolder}
          onRenameFolder={handleRenameFolder}
          isAdmin={isAdmin}
          suites={suites}
          onRefresh={load}
        />

        {/* Right: Cases Table */}
        <div style={{ flex: 1, display: 'flex', flexDirection: 'column', minWidth: 0 }}>
          {/* Single-row toolbar: search + filters + sort + count */}
          <div style={{ padding: '0.4rem 0.6rem', borderBottom: '1px solid var(--border)', display: 'flex', gap: '0.35rem', alignItems: 'center', flexShrink: 0 }}>
            <div style={{ position: 'relative', width: 180, flexShrink: 0 }}>
              <Search size={11} style={{ position: 'absolute', left: 7, top: '50%', transform: 'translateY(-50%)', color: 'var(--text-muted)' }} />
              <input value={searchQuery} onChange={e => setSearchQuery(e.target.value)} placeholder="Search..." style={{ width: '100%', paddingLeft: 24, fontSize: '0.7rem', height: 28 }} />
            </div>
            <select value={filterMode} onChange={e => setFilterMode(e.target.value)} style={{ fontSize: '0.68rem', height: 28, padding: '0 0.4em' }}>
              <option value="">Mode</option>
              <option value="fixed">Fixed</option>
              <option value="hybrid">Hybrid</option>
              <option value="explore">Explore</option>
            </select>
            <select value={filterStatus} onChange={e => setFilterStatus(e.target.value)} style={{ fontSize: '0.68rem', height: 28, padding: '0 0.4em' }}>
              <option value="">Status</option>
              <option value="draft">Draft</option>
              <option value="approved">Approved</option>
              <option value="rejected">Rejected</option>
            </select>
            <select value={filterPriority} onChange={e => setFilterPriority(e.target.value)} style={{ fontSize: '0.68rem', height: 28, padding: '0 0.4em' }}>
              <option value="">Priority</option>
              <option value="high">High</option>
              <option value="medium">Medium</option>
              <option value="low">Low</option>
            </select>
            <div style={{ borderLeft: '1px solid var(--border)', height: 16, margin: '0 0.1rem' }} />
            <select value={`${sortBy}:${sortDir}`} onChange={e => { const [col, dir] = e.target.value.split(':'); setSortBy(col); setSortDir(dir) }} style={{ fontSize: '0.68rem', height: 28, padding: '0 0.4em' }}>
              <option value="name:asc">Name A-Z</option>
              <option value="name:desc">Name Z-A</option>
              <option value="priority:asc">Priority ↑</option>
              <option value="priority:desc">Priority ↓</option>
              <option value="status:asc">Status ↑</option>
              <option value="status:desc">Status ↓</option>
              <option value="score:desc">Score ↓</option>
              <option value="score:asc">Score ↑</option>
              <option value="runs:desc">Runs ↓</option>
              <option value="runs:asc">Runs ↑</option>
            </select>
            <span style={{ fontSize: '0.65rem', color: 'var(--text-muted)', marginLeft: 'auto', whiteSpace: 'nowrap' }}>{filteredCases.length}/{cases.length}</span>
          </div>

          {/* Bulk actions bar */}
          {selectedCases.size > 0 && isAdmin && (
            <div style={{ padding: '0.3rem 0.6rem', borderBottom: '1px solid var(--border)', background: 'var(--bg-primary)', display: 'flex', gap: '0.35rem', alignItems: 'center', fontSize: '0.68rem', flexShrink: 0 }}>
              <span style={{ color: 'var(--text-muted)', fontWeight: 500 }}>{selectedCases.size} selected</span>
              <button onClick={handleBulkApprove} className="primary" style={{ fontSize: '0.63rem', padding: '0.15em 0.45em' }}><Check size={9} /> Approve</button>
              <select onChange={e => { if (e.target.value) { handleBulkMove(e.target.value === '__root' ? null : e.target.value); e.target.value = '' } }} style={{ fontSize: '0.63rem', height: 24 }}>
                <option value="">Move to...</option>
                <option value="__root">Unorganized</option>
                {folders.map(f => <option key={f.id} value={f.id}>{f.name}</option>)}
              </select>
              {suites.length > 0 && (
                <select onChange={async e => { if (e.target.value) { try { await addCasesToSuite(e.target.value, [...selectedCases]); setSelectedCases(new Set()); await load() } catch {} e.target.value = '' } }} style={{ fontSize: '0.63rem', height: 24 }}>
                  <option value="">Add to suite...</option>
                  {suites.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
                </select>
              )}
              <button onClick={handleBulkDelete} style={{ fontSize: '0.63rem', padding: '0.15em 0.45em', color: 'var(--red)' }}><Trash2 size={9} /> Delete</button>
              <button onClick={clearSelection} style={{ fontSize: '0.63rem', padding: '0.15em 0.45em' }}>Clear</button>
            </div>
          )}

          {/* Scrollable table */}
          <div style={{ flex: 1, overflow: 'auto' }}>
            {filteredCases.length === 0 ? (
              <div style={{ padding: '3rem', textAlign: 'center', color: 'var(--text-muted)', fontSize: '0.8rem' }}>
                {cases.length === 0 ? 'No test cases yet. Create one or import builtins.' : 'No cases match your filters.'}
              </div>
            ) : (
              <table style={{ width: '100%', fontSize: '0.73rem', borderCollapse: 'collapse' }}>
                <thead style={{ position: 'sticky', top: 0, zIndex: 1 }}>
                  <tr style={{ borderBottom: '1px solid var(--border)', background: 'var(--bg-primary)' }}>
                    <th style={{ width: 28, padding: '0.3rem' }}>
                      <input type="checkbox" checked={selectedCases.size === filteredCases.length && filteredCases.length > 0}
                        onChange={e => e.target.checked ? selectAll() : clearSelection()} />
                    </th>
                    {[
                      { key: 'name', label: 'Name', align: 'left', width: undefined },
                      { key: 'mode', label: 'Mode', align: 'center', width: 55 },
                      { key: 'priority', label: 'Priority', align: 'center', width: 55 },
                      { key: 'status', label: 'Status', align: 'center', width: 65 },
                      { key: 'score', label: 'Score', align: 'center', width: 55 },
                      { key: 'runs', label: 'Runs', align: 'center', width: 50 },
                    ].map(col => (
                      <th key={col.key} onClick={() => toggleSort(col.key)} style={{
                        textAlign: col.align, padding: '0.3rem 0.5rem', fontWeight: 600, width: col.width,
                        cursor: 'pointer', userSelect: 'none', whiteSpace: 'nowrap',
                      }}>
                        {col.label}
                        {sortBy === col.key && <span style={{ marginLeft: 2, fontSize: '0.6rem', opacity: 0.6 }}>{sortDir === 'asc' ? '▲' : '▼'}</span>}
                      </th>
                    ))}
                    {isAdmin && <th style={{ textAlign: 'right', padding: '0.3rem 0.5rem', fontWeight: 600, width: 80 }}>Actions</th>}
                  </tr>
                </thead>
                <tbody>
                  {filteredCases.map(tc => (
                    <tr key={tc.id} style={{ borderBottom: '1px solid var(--border)' }}
                      onDoubleClick={() => setViewCase(tc)}>
                      <td style={{ padding: '0.25rem 0.3rem', textAlign: 'center' }}>
                        <input type="checkbox" checked={selectedCases.has(tc.id)} onChange={() => toggleSelect(tc.id)} />
                      </td>
                      <td style={{ padding: '0.25rem 0.5rem' }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: '0.3rem' }}>
                          <span style={{ cursor: 'pointer', color: 'var(--accent)', fontWeight: 500 }} onClick={() => setViewCase(tc)}>{tc.name}</span>
                          {tc.tags?.includes('promoted') && <Badge color="var(--accent)">Promoted</Badge>}
                          {tc.tags?.includes('builtin') && <Badge color="var(--text-muted)">Builtin</Badge>}
                          {tc.template ? <Badge color="var(--orange)">Template</Badge> : null}
                        </div>
                        {tc.category && tc.category !== 'general' && (
                          <span style={{ fontSize: '0.63rem', color: 'var(--text-muted)' }}>{tc.category}</span>
                        )}
                      </td>
                      <td style={{ textAlign: 'center', padding: '0.25rem' }}><Badge color={MODE_COLORS[tc.mode] || 'var(--text-muted)'}>{tc.mode}</Badge></td>
                      <td style={{ textAlign: 'center', padding: '0.25rem' }}><Badge color={PRIORITY_COLORS[tc.priority] || 'var(--text-muted)'}>{tc.priority}</Badge></td>
                      <td style={{ textAlign: 'center', padding: '0.25rem' }}><Badge color={STATUS_COLORS[tc.status] || 'var(--text-muted)'}>{tc.status}</Badge></td>
                      <td style={{ textAlign: 'center', padding: '0.25rem', fontSize: '0.7rem' }}>
                        {tc.last_run_score != null ? tc.last_run_score.toFixed(1) : '-'}
                      </td>
                      <td style={{ textAlign: 'center', padding: '0.25rem', fontSize: '0.7rem', color: 'var(--text-muted)' }}>
                        {tc.run_count || 0}
                      </td>
                      {isAdmin && (
                        <td style={{ textAlign: 'right', padding: '0.25rem 0.5rem' }}>
                          <div style={{ display: 'flex', gap: '0.15rem', justifyContent: 'flex-end' }}>
                            {tc.status === 'draft' && (
                              <button onClick={async () => { try { await updateTestCase(tc.id, { status: 'approved' }); await load() } catch {} }}
                                title="Approve" style={{ fontSize: '0.6rem', padding: '0.1em 0.25em', color: 'var(--green)' }}><Check size={10} /></button>
                            )}
                            <button onClick={() => setViewCase(tc)} title="View/Edit" style={{ fontSize: '0.6rem', padding: '0.1em 0.25em' }}><Edit3 size={10} /></button>
                            <button onClick={() => handleDeleteCase(tc.id)} title="Delete" style={{ fontSize: '0.6rem', padding: '0.1em 0.25em', color: 'var(--red)' }}><Trash2 size={10} /></button>
                          </div>
                        </td>
                      )}
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        </div>
      </div>

      {/* Create Case Modal */}
      {showCreateCase && (
        <CreateCaseModal
          folders={folders}
          selectedFolder={selectedFolder}
          onClose={() => setShowCreateCase(false)}
          onCreated={async () => { setShowCreateCase(false); await load() }}
        />
      )}

      {/* View/Edit Case Modal */}
      {viewCase && (
        <CaseDetailModal
          testCase={viewCase}
          folders={folders}
          isAdmin={isAdmin}
          onClose={() => setViewCase(null)}
          onSaved={async () => { setViewCase(null); await load() }}
        />
      )}

      {confirmModal && <ConfirmModal {...confirmModal} />}
    </div>
  )
}

// ── Create Case Modal ──────────────────────────────────────────

function CreateCaseModal({ folders, selectedFolder, onClose, onCreated }) {
  const [name, setName] = useState('')
  const [mode, setMode] = useState('fixed')
  const [description, setDescription] = useState('')
  const [priority, setPriority] = useState('medium')
  const [category, setCategory] = useState('general')
  const [folderId, setFolderId] = useState(selectedFolder && selectedFolder !== '__unorganized' ? selectedFolder : '')
  const [goal, setGoal] = useState('')
  const [maxTurns, setMaxTurns] = useState(10)
  const [steps, setSteps] = useState([{ name: 'Step 1', message: '' }])
  const [tags, setTags] = useState('')
  const [saving, setSaving] = useState(false)

  const handleSave = async () => {
    if (!name.trim()) return
    setSaving(true)
    try {
      await createTestCaseManual({
        name, mode, description, priority, category,
        folder_id: folderId || null,
        steps: mode === 'fixed' ? steps.filter(s => s.message.trim()) : [],
        goal: mode !== 'fixed' ? goal : '',
        max_turns: maxTurns,
        tags: tags.split(',').map(t => t.trim()).filter(Boolean),
      })
      onCreated()
    } catch { /* ignore */ }
    setSaving(false)
  }

  return (
    <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.4)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000 }} onClick={onClose}>
      <div style={{ background: 'var(--bg-card)', borderRadius: 'var(--radius)', padding: '1.5rem', width: 580, maxHeight: '85vh', overflow: 'auto', boxShadow: '0 8px 30px rgba(0,0,0,0.15)' }} onClick={e => e.stopPropagation()}>
        <h3 style={{ margin: '0 0 0.75rem', fontSize: '0.9rem' }}>New Test Case</h3>

        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.5rem', marginBottom: '0.5rem' }}>
          <div>
            <label style={{ fontSize: '0.7rem', fontWeight: 600 }}>Name *</label>
            <input value={name} onChange={e => setName(e.target.value)} placeholder="Test case name" style={{ width: '100%' }} />
          </div>
          <div>
            <label style={{ fontSize: '0.7rem', fontWeight: 600 }}>Folder</label>
            <select value={folderId} onChange={e => setFolderId(e.target.value)} style={{ width: '100%' }}>
              <option value="">Unorganized</option>
              {folders.map(f => <option key={f.id} value={f.id}>{f.name}</option>)}
            </select>
          </div>
        </div>

        <div style={{ marginBottom: '0.5rem' }}>
          <label style={{ fontSize: '0.7rem', fontWeight: 600 }}>Description</label>
          <textarea value={description} onChange={e => setDescription(e.target.value)} rows={2} style={{ width: '100%' }} />
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr 1fr', gap: '0.5rem', marginBottom: '0.5rem' }}>
          <div>
            <label style={{ fontSize: '0.7rem', fontWeight: 600 }}>Mode</label>
            <select value={mode} onChange={e => setMode(e.target.value)} style={{ width: '100%' }}>
              <option value="fixed">Fixed</option>
              <option value="hybrid">Hybrid</option>
              <option value="explore">Explore</option>
            </select>
          </div>
          <div>
            <label style={{ fontSize: '0.7rem', fontWeight: 600 }}>Priority</label>
            <select value={priority} onChange={e => setPriority(e.target.value)} style={{ width: '100%' }}>
              <option value="high">High</option>
              <option value="medium">Medium</option>
              <option value="low">Low</option>
            </select>
          </div>
          <div>
            <label style={{ fontSize: '0.7rem', fontWeight: 600 }}>Category</label>
            <input value={category} onChange={e => setCategory(e.target.value)} style={{ width: '100%' }} />
          </div>
          <div>
            <label style={{ fontSize: '0.7rem', fontWeight: 600 }}>Max Turns</label>
            <input type="number" min={1} max={50} value={maxTurns} onChange={e => setMaxTurns(+e.target.value)} style={{ width: '100%' }} />
          </div>
        </div>

        {mode !== 'fixed' && (
          <div style={{ marginBottom: '0.5rem' }}>
            <label style={{ fontSize: '0.7rem', fontWeight: 600 }}>Goal</label>
            <textarea value={goal} onChange={e => setGoal(e.target.value)} rows={2} style={{ width: '100%' }} placeholder="What should the conversation achieve?" />
          </div>
        )}

        {mode === 'fixed' && (
          <div style={{ marginBottom: '0.5rem' }}>
            <label style={{ fontSize: '0.7rem', fontWeight: 600 }}>Rounds</label>
            {steps.map((step, i) => (
              <div key={i} style={{ display: 'flex', gap: '0.3rem', marginBottom: '0.25rem' }}>
                <input value={step.name} onChange={e => setSteps(s => s.map((st, j) => j === i ? { ...st, name: e.target.value } : st))} placeholder="Step name" style={{ width: 100, fontSize: '0.7rem' }} />
                <input value={step.message} onChange={e => setSteps(s => s.map((st, j) => j === i ? { ...st, message: e.target.value } : st))} placeholder="User message" style={{ flex: 1, fontSize: '0.7rem' }} />
                <button onClick={() => setSteps(s => s.filter((_, j) => j !== i))} style={{ fontSize: '0.6rem', padding: '0.15em', color: 'var(--red)' }}><Trash2 size={10} /></button>
              </div>
            ))}
            <button onClick={() => setSteps(s => [...s, { name: `Step ${s.length + 1}`, message: '' }])} style={{ fontSize: '0.65rem' }}>+ Add Round</button>
          </div>
        )}

        <div style={{ marginBottom: '0.75rem' }}>
          <label style={{ fontSize: '0.7rem', fontWeight: 600 }}>Tags (comma-separated)</label>
          <input value={tags} onChange={e => setTags(e.target.value)} style={{ width: '100%' }} placeholder="happy, auth, smoke" />
        </div>

        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '0.5rem' }}>
          <button onClick={onClose}>Cancel</button>
          <button className="primary" onClick={handleSave} disabled={saving || !name.trim()}>
            {saving ? 'Creating...' : 'Create'}
          </button>
        </div>
      </div>
    </div>
  )
}

// ── Case Detail Modal ──────────────────────────────────────────

function CaseDetailModal({ testCase: tc, folders, isAdmin, onClose, onSaved }) {
  const [editing, setEditing] = useState(false)
  const [name, setName] = useState(tc.name)
  const [description, setDescription] = useState(tc.description || '')
  const [mode, setMode] = useState(tc.mode)
  const [priority, setPriority] = useState(tc.priority)
  const [category, setCategory] = useState(tc.category)
  const [folderId, setFolderId] = useState(tc.folder_id || '')
  const [goal, setGoal] = useState(tc.goal || '')
  const [maxTurns, setMaxTurns] = useState(tc.max_turns)
  const [steps, setSteps] = useState(tc.steps || [])
  const [tags, setTags] = useState((tc.tags || []).join(', '))
  const [saving, setSaving] = useState(false)
  const [history, setHistory] = useState(null)

  const loadHistory = async () => {
    try {
      const data = await getCaseRunHistory(tc.id)
      setHistory(data.history || [])
    } catch { setHistory([]) }
  }

  const handleSave = async () => {
    setSaving(true)
    try {
      await updateTestCase(tc.id, {
        name, description, mode, priority, category, goal,
        max_turns: maxTurns, steps,
        tags: tags.split(',').map(t => t.trim()).filter(Boolean),
        folder_id: folderId || null,
      })
      onSaved()
    } catch { /* ignore */ }
    setSaving(false)
  }

  return (
    <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.4)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000 }} onClick={onClose}>
      <div style={{ background: 'var(--bg-card)', borderRadius: 'var(--radius)', padding: '1.5rem', width: 640, maxHeight: '85vh', overflow: 'auto', boxShadow: '0 8px 30px rgba(0,0,0,0.15)' }} onClick={e => e.stopPropagation()}>
        {!editing ? (
          <>
            {/* View mode */}
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '0.75rem' }}>
              <div>
                <h3 style={{ margin: 0, fontSize: '0.95rem' }}>
                  {tc.name}
                  {tc.tags?.includes('promoted') && <Badge color="var(--accent)"> Promoted</Badge>}
                </h3>
                <div style={{ display: 'flex', gap: '0.3rem', marginTop: '0.3rem' }}>
                  <Badge color={MODE_COLORS[tc.mode]}>{tc.mode}</Badge>
                  <Badge color={PRIORITY_COLORS[tc.priority]}>{tc.priority}</Badge>
                  <Badge color={STATUS_COLORS[tc.status]}>{tc.status}</Badge>
                  {tc.category && <Badge color="var(--text-muted)">{tc.category}</Badge>}
                </div>
              </div>
              <button onClick={onClose} style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-muted)' }}><X size={16} /></button>
            </div>

            {tc.description && <p style={{ fontSize: '0.78rem', color: 'var(--text-secondary)', margin: '0 0 0.6rem', lineHeight: 1.5 }}>{tc.description}</p>}

            {tc.goal && (
              <div style={{ marginBottom: '0.6rem' }}>
                <div style={{ fontSize: '0.68rem', fontWeight: 600, color: 'var(--text-muted)', textTransform: 'uppercase', marginBottom: '0.15rem' }}>Goal</div>
                <div style={{ fontSize: '0.76rem', padding: '0.4rem 0.6rem', background: 'var(--bg-primary)', borderRadius: '6px' }}>{tc.goal}</div>
              </div>
            )}

            {tc.steps?.length > 0 && (
              <div style={{ marginBottom: '0.6rem' }}>
                <div style={{ fontSize: '0.68rem', fontWeight: 600, color: 'var(--text-muted)', textTransform: 'uppercase', marginBottom: '0.2rem' }}>Rounds ({tc.steps.length})</div>
                {tc.steps.map((s, i) => (
                  <div key={i} style={{ fontSize: '0.73rem', padding: '0.3rem 0.5rem', background: 'var(--bg-primary)', borderRadius: '5px', borderLeft: '3px solid var(--accent)', marginBottom: '0.2rem' }}>
                    <strong>{s.name}</strong>: {s.message}
                  </div>
                ))}
              </div>
            )}

            {tc.mcp_tools_tested?.length > 0 && (
              <div style={{ marginBottom: '0.6rem' }}>
                <div style={{ fontSize: '0.68rem', fontWeight: 600, color: 'var(--text-muted)', textTransform: 'uppercase', marginBottom: '0.15rem' }}>MCP Tools</div>
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.2rem' }}>
                  {tc.mcp_tools_tested.map((t, i) => <span key={i} style={{ fontSize: '0.65rem', padding: '0.1em 0.4em', borderRadius: '8px', background: '#e0e7ff', color: 'var(--accent)' }}>{t}</span>)}
                </div>
              </div>
            )}

            {tc.source_items?.length > 0 && (
              <div style={{ marginBottom: '0.6rem' }}>
                <div style={{ fontSize: '0.68rem', fontWeight: 600, color: 'var(--text-muted)', textTransform: 'uppercase', marginBottom: '0.15rem' }}>Requirements</div>
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.2rem' }}>
                  {tc.source_items.map((si, i) => <span key={i} style={{ fontSize: '0.65rem', padding: '0.1em 0.4em', borderRadius: '8px', background: 'var(--bg-primary)' }}>{si.external_id || si.title}</span>)}
                </div>
              </div>
            )}

            <div style={{ display: 'flex', gap: '0.6rem', fontSize: '0.68rem', color: 'var(--text-muted)', borderTop: '1px solid var(--border)', paddingTop: '0.5rem', marginBottom: '0.5rem' }}>
              <span>Max turns: <strong>{tc.max_turns}</strong></span>
              {tc.last_run_score != null && <span>Last score: <strong>{tc.last_run_score.toFixed(1)}</strong></span>}
              {tc.run_count > 0 && <span>Runs: <strong>{tc.run_count}</strong></span>}
            </div>

            {/* Run history */}
            {history === null ? (
              <button onClick={loadHistory} style={{ fontSize: '0.68rem', marginBottom: '0.5rem' }}>Show run history</button>
            ) : history.length > 0 && (
              <div style={{ marginBottom: '0.5rem' }}>
                <div style={{ fontSize: '0.68rem', fontWeight: 600, color: 'var(--text-muted)', textTransform: 'uppercase', marginBottom: '0.2rem' }}>Run History</div>
                <div style={{ display: 'flex', gap: '0.2rem', flexWrap: 'wrap' }}>
                  {history.slice(0, 10).map((r, i) => (
                    <span key={i} style={{
                      fontSize: '0.6rem', padding: '0.15em 0.4em', borderRadius: '6px',
                      background: r.passed ? '#dcfce7' : '#fee2e2',
                      color: r.passed ? 'var(--green)' : 'var(--red)',
                    }} title={r.run_at}>
                      {r.score != null ? r.score.toFixed(1) : '?'}
                    </span>
                  ))}
                </div>
              </div>
            )}

            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '0.5rem' }}>
              {isAdmin && <button onClick={() => setEditing(true)}><Edit3 size={12} style={{ verticalAlign: 'middle', marginRight: '0.2rem' }} />Edit</button>}
              <button onClick={onClose}>Close</button>
            </div>
          </>
        ) : (
          <>
            {/* Edit mode */}
            <h3 style={{ margin: '0 0 0.75rem', fontSize: '0.9rem' }}>Edit Test Case</h3>

            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.5rem', marginBottom: '0.5rem' }}>
              <div>
                <label style={{ fontSize: '0.7rem', fontWeight: 600 }}>Name</label>
                <input value={name} onChange={e => setName(e.target.value)} style={{ width: '100%' }} />
              </div>
              <div>
                <label style={{ fontSize: '0.7rem', fontWeight: 600 }}>Folder</label>
                <select value={folderId} onChange={e => setFolderId(e.target.value)} style={{ width: '100%' }}>
                  <option value="">Unorganized</option>
                  {folders.map(f => <option key={f.id} value={f.id}>{f.name}</option>)}
                </select>
              </div>
            </div>

            <div style={{ marginBottom: '0.5rem' }}>
              <label style={{ fontSize: '0.7rem', fontWeight: 600 }}>Description</label>
              <textarea value={description} onChange={e => setDescription(e.target.value)} rows={2} style={{ width: '100%' }} />
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr 1fr', gap: '0.5rem', marginBottom: '0.5rem' }}>
              <div>
                <label style={{ fontSize: '0.7rem', fontWeight: 600 }}>Mode</label>
                <select value={mode} onChange={e => setMode(e.target.value)} style={{ width: '100%' }}>
                  <option value="fixed">Fixed</option>
                  <option value="hybrid">Hybrid</option>
                  <option value="explore">Explore</option>
                </select>
              </div>
              <div>
                <label style={{ fontSize: '0.7rem', fontWeight: 600 }}>Priority</label>
                <select value={priority} onChange={e => setPriority(e.target.value)} style={{ width: '100%' }}>
                  <option value="high">High</option>
                  <option value="medium">Medium</option>
                  <option value="low">Low</option>
                </select>
              </div>
              <div>
                <label style={{ fontSize: '0.7rem', fontWeight: 600 }}>Category</label>
                <input value={category} onChange={e => setCategory(e.target.value)} style={{ width: '100%' }} />
              </div>
              <div>
                <label style={{ fontSize: '0.7rem', fontWeight: 600 }}>Max Turns</label>
                <input type="number" min={1} max={50} value={maxTurns} onChange={e => setMaxTurns(+e.target.value)} style={{ width: '100%' }} />
              </div>
            </div>

            {mode !== 'fixed' && (
              <div style={{ marginBottom: '0.5rem' }}>
                <label style={{ fontSize: '0.7rem', fontWeight: 600 }}>Goal</label>
                <textarea value={goal} onChange={e => setGoal(e.target.value)} rows={2} style={{ width: '100%' }} />
              </div>
            )}

            {mode === 'fixed' && (
              <div style={{ marginBottom: '0.5rem' }}>
                <label style={{ fontSize: '0.7rem', fontWeight: 600 }}>Rounds</label>
                {steps.map((step, i) => (
                  <div key={i} style={{ display: 'flex', gap: '0.3rem', marginBottom: '0.2rem' }}>
                    <input value={step.name} onChange={e => setSteps(s => s.map((st, j) => j === i ? { ...st, name: e.target.value } : st))} style={{ width: 100, fontSize: '0.7rem' }} />
                    <input value={step.message} onChange={e => setSteps(s => s.map((st, j) => j === i ? { ...st, message: e.target.value } : st))} style={{ flex: 1, fontSize: '0.7rem' }} />
                    <button onClick={() => setSteps(s => s.filter((_, j) => j !== i))} style={{ color: 'var(--red)', fontSize: '0.6rem' }}><Trash2 size={10} /></button>
                  </div>
                ))}
                <button onClick={() => setSteps(s => [...s, { name: `Step ${s.length + 1}`, message: '' }])} style={{ fontSize: '0.65rem' }}>+ Add Round</button>
              </div>
            )}

            <div style={{ marginBottom: '0.75rem' }}>
              <label style={{ fontSize: '0.7rem', fontWeight: 600 }}>Tags</label>
              <input value={tags} onChange={e => setTags(e.target.value)} style={{ width: '100%' }} placeholder="comma-separated" />
            </div>

            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '0.5rem' }}>
              <button onClick={() => setEditing(false)}>Cancel</button>
              <button className="primary" onClick={handleSave} disabled={saving}>{saving ? 'Saving...' : 'Save'}</button>
            </div>
          </>
        )}
      </div>
    </div>
  )
}
