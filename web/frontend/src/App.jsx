import { useState, useEffect, createContext, useContext } from 'react'
import { Routes, Route, NavLink } from 'react-router-dom'
import { Flame, LayoutDashboard, List, BarChart3, Settings, Zap, Trophy, Heart, HeartOff, BookOpen, Scale, Globe, User, LogOut, Lock, TrendingUp } from 'lucide-react'
import './App.css'
import SessionLauncher from './components/SessionLauncher'
import SessionList from './components/SessionList'
import SessionDetail from './components/SessionDetail'
import MatchList from './components/MatchList'
import MatchReport from './components/MatchReport'
import Reports from './components/Reports'
import MatchTrends from './components/MatchTrends'
import RubricSettings from './components/RubricSettings'
import EnvironmentSettings from './components/EnvironmentSettings'
import { listSessions, listMatches, checkHealth, getConfig, login, getMe, logout } from './api'

// Global admin context
export const AdminContext = createContext({ admin: null, setAdmin: () => {} })
export function useAdmin() { return useContext(AdminContext) }

function AdminButton() {
  const { admin, setAdmin } = useAdmin()
  const [showLogin, setShowLogin] = useState(false)
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState(null)
  const [loading, setLoading] = useState(false)

  const handleLogin = async (e) => {
    e.preventDefault()
    setError(null)
    setLoading(true)
    try {
      const data = await login(username, password)
      setAdmin(data.username)
      setShowLogin(false)
      setUsername('')
      setPassword('')
    } catch (err) {
      setError(err.message)
    } finally {
      setLoading(false)
    }
  }

  const handleLogout = () => {
    logout()
    setAdmin(null)
  }

  if (admin) {
    return (
      <div className="admin-bar">
        <User size={13} />
        <span>{admin}</span>
        <button onClick={handleLogout} className="admin-logout" title="Sign out">
          <LogOut size={12} />
        </button>
      </div>
    )
  }

  return (
    <div className="admin-bar">
      <button onClick={() => setShowLogin(!showLogin)} className="admin-login-btn" title="Admin sign in">
        <Lock size={13} /> Sign in
      </button>
      {showLogin && (
        <div className="admin-dropdown">
          <form onSubmit={handleLogin}>
            <input value={username} onChange={e => setUsername(e.target.value)} placeholder="Username" required autoFocus />
            <input type="password" value={password} onChange={e => setPassword(e.target.value)} placeholder="Password" required />
            {error && <div style={{ fontSize: '0.72rem', color: 'var(--red)' }}>{error}</div>}
            <button type="submit" className="primary" disabled={loading} style={{ width: '100%', fontSize: '0.75rem' }}>
              {loading ? 'Signing in...' : 'Sign In'}
            </button>
          </form>
        </div>
      )}
    </div>
  )
}

function App() {
  const [activeCount, setActiveCount] = useState(0)
  const [maxConcurrent, setMaxConcurrent] = useState(10)
  const [activeMatches, setActiveMatches] = useState(0)
  const [maxMatches, setMaxMatches] = useState(3)
  const [healthy, setHealthy] = useState(null)
  const [activeEnv, setActiveEnv] = useState('')
  const [activeProject, setActiveProject] = useState('')
  const [admin, setAdmin] = useState(null)

  useEffect(() => {
    const poll = async () => {
      try {
        const data = await listSessions(5)
        setActiveCount(data.active_count)
        setMaxConcurrent(data.max_concurrent)
      } catch {}
      try {
        const mdata = await listMatches(5)
        setActiveMatches(mdata.active_count)
        setMaxMatches(mdata.max_concurrent)
      } catch {}
    }
    poll()
    const interval = setInterval(poll, 5000)
    return () => clearInterval(interval)
  }, [])

  useEffect(() => {
    checkHealth().then(d => setHealthy(d.healthy)).catch(() => setHealthy(false))
    getConfig().then(d => {
      setActiveEnv(d.active_env_name || 'Production')
      setActiveProject(d.active_project || '')
    }).catch(() => {})
    // Check if already logged in
    getMe().then(d => setAdmin(d?.username || null)).catch(() => {})
  }, [])

  const runHealthCheck = async () => {
    setHealthy(null)
    try {
      const d = await checkHealth()
      setHealthy(d.healthy)
    } catch {
      setHealthy(false)
    }
  }

  return (
    <AdminContext.Provider value={{ admin, setAdmin }}>
      <div className="app">
        <aside className="sidebar">
          <div className="sidebar-brand">
            <span className="brand-icon">&#x1F94A;</span>
            <div>
              <h1>Joe vs <svg style={{ display: 'inline', verticalAlign: 'middle', marginRight: '0.15rem' }} viewBox="0 0 16 16" width="14" height="14" fill="none" xmlns="http://www.w3.org/2000/svg"><path d="M7.32922 14.0581C8.36662 12.18 9.92639 10.636 11.8232 9.6088L12.1685 9.42177L11.8232 9.23474C9.92639 8.20756 8.36662 6.66317 7.32922 4.78504L7.14033 4.44319L6.34521 5.88266C5.8628 6.756 5.19781 7.51252 4.39888 8.10421C3.55127 8.59062 2.76274 8.18698 2.39063 7.84133C1.98314 7.34768 1.74702 6.76425 1.74698 6.13862C1.74707 4.73448 2.93412 3.54189 4.58707 3.10589C2.44914 3.34427 0.800049 4.86908 0.800049 6.716C0.800196 8.09087 2.05235 9.48909 3.61566 10.2371C4.7661 10.8722 5.71277 11.8156 6.34521 12.9605L7.14032 14.4L7.32922 14.0581Z" fill="#FCFCFC"/><path d="M11.607 1.60001C10.9493 2.79082 9.96047 3.77002 8.75794 4.42129C9.96043 5.07255 10.9493 6.05147 11.607 7.24223L12.0576 6.42676C12.3309 5.9318 12.7076 5.50285 13.1604 5.16753C13.6419 4.89108 14.09 5.12169 14.3003 5.31789C14.5303 5.59727 14.6633 5.92748 14.6633 6.28129C14.6633 7.07711 13.9905 7.753 13.0537 8.00001C14.2654 7.8651 15.2 7.00108 15.2 5.95433C15.2 5.17296 14.4866 4.37814 13.5972 3.95516C12.9485 3.59529 12.4146 3.06228 12.0576 2.41583L11.607 1.60001Z" fill="#FCFCFC"/></svg>Kai</h1>
              <p className="subtitle">AI Agent Test Arena</p>
            </div>
          </div>
          <div className="sidebar-banner">
            <img src="/boxing-game.png" alt="Battle of the Bots" />
          </div>
          <nav>
            <NavLink to="/" end className={({ isActive }) => isActive ? 'active' : ''}>
              <Zap size={16} /> New Match
            </NavLink>
            <NavLink to="/matches" className={({ isActive }) => isActive ? 'active' : ''}>
              <Trophy size={16} /> Matches
            </NavLink>
            <NavLink to="/sessions" className={({ isActive }) => isActive ? 'active' : ''}>
              <List size={16} /> Rounds
            </NavLink>
            <NavLink to="/reports" className={({ isActive }) => isActive ? 'active' : ''}>
              <BarChart3 size={16} /> Fight Record
            </NavLink>
            <NavLink to="/trends" className={({ isActive }) => isActive ? 'active' : ''}>
              <TrendingUp size={16} /> Match Analysis
            </NavLink>
            <NavLink to="/rubric" className={({ isActive }) => isActive ? 'active' : ''}>
              <Scale size={16} /> Judging Criteria
            </NavLink>
            <NavLink to="/environment" className={({ isActive }) => isActive ? 'active' : ''}>
              <Settings size={16} /> Arena Settings
            </NavLink>
          </nav>
          <div className="status-bar">
            {activeEnv && (
              <div className="status-indicator" title={activeProject}>
                <Globe size={10} style={{ color: activeEnv === 'Production' ? 'var(--green)' : 'var(--orange)' }} />
                <span style={{ fontSize: '0.68rem' }}>{activeEnv}{activeProject ? ` — ${activeProject}` : ''}</span>
              </div>
            )}
            <div className="status-indicator">
              <span className={`dot ${activeCount > 0 ? 'active' : ''}`} />
              {activeCount}/{maxConcurrent} rounds
            </div>
            <div className="status-indicator">
              <span className={`dot ${activeMatches > 0 ? 'active' : ''}`} />
              {activeMatches}/{maxMatches} matches
            </div>
            <button
              onClick={runHealthCheck}
              className="health-btn"
              title={healthy === true ? 'Fighters ready' : healthy === false ? 'Fighters not ready' : 'Weighing in...'}
            >
              {healthy === null
                ? <><span className="spinner" style={{ width: 10, height: 10 }} /> Weigh-in...</>
                : healthy
                  ? <><Heart size={12} style={{ color: 'var(--green)' }} /> Weigh-in: Ready</>
                  : <><HeartOff size={12} style={{ color: 'var(--red)' }} /> Weigh-in: Failed</>
              }
            </button>
          </div>
        </aside>
        <main className="main">
          <div className="top-bar">
            <AdminButton />
          </div>
          <Routes>
            <Route path="/" element={<SessionLauncher />} />
            <Route path="/matches" element={<MatchList />} />
            <Route path="/matches/:matchId" element={<MatchReport />} />
            <Route path="/sessions" element={<SessionList />} />
            <Route path="/sessions/:id" element={<SessionDetail />} />
            <Route path="/batch/:batchId" element={<MatchReport />} />
            <Route path="/reports" element={<Reports />} />
            <Route path="/trends" element={<MatchTrends />} />
            <Route path="/rubric" element={<RubricSettings />} />
            <Route path="/environment" element={<EnvironmentSettings />} />
          </Routes>
        </main>
      </div>
    </AdminContext.Provider>
  )
}

export default App
