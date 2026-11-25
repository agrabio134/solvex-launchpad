import { useEffect } from 'react'
import { Route, Routes, useLocation } from 'react-router-dom'
import Header from './components/Header'
import Footer from './components/Footer'
import Home from './pages/Home'
import Board from './pages/Board'
import Launch from './pages/Launch'
import Token from './pages/Token'
import Profile from './pages/Profile'
import Docs from './pages/Docs'
import { DEMO } from './lib/config'

export default function App() {
  const { pathname, hash } = useLocation()
  useEffect(() => {
    if (!hash) window.scrollTo(0, 0)
  }, [pathname, hash])

  return (
    <>
      {DEMO && (
        <div className="demo-banner">
          Preview mode — sample coins shown. Set <code>VITE_SVX_MINT</code> and <code>VITE_DBC_CONFIG</code> to go live.
        </div>
      )}
      <Header />
      <main>
        <Routes>
          <Route path="/" element={<Home />} />
          <Route path="/board" element={<Board />} />
          <Route path="/launch" element={<Launch />} />
          <Route path="/coin/:id" element={<Token />} />
          <Route path="/profile" element={<Profile />} />
          <Route path="/docs" element={<Docs />} />
          <Route path="*" element={<Home />} />
        </Routes>
      </main>
      <Footer />
    </>
  )
}
