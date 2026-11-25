import { useEffect } from 'react'
import { Route, Routes, useLocation } from 'react-router-dom'
import Header from './components/Header'
import Footer from './components/Footer'
import Gate from './components/Gate'
import Home from './pages/Home'
import Board from './pages/Board'
import Launch from './pages/Launch'
import Token from './pages/Token'
import Profile from './pages/Profile'
import Docs from './pages/Docs'

export default function App() {
  const { pathname, hash } = useLocation()
  useEffect(() => {
    if (!hash) window.scrollTo(0, 0)
  }, [pathname, hash])

  return (
    <>
      <Header />
      <main>
        <Routes>
          <Route path="/" element={<Home />} />
          <Route path="/board" element={<Gate><Board /></Gate>} />
          <Route path="/launch" element={<Gate><Launch /></Gate>} />
          <Route path="/coin/:id" element={<Gate><Token /></Gate>} />
          <Route path="/profile" element={<Gate><Profile /></Gate>} />
          <Route path="/docs" element={<Docs />} />
          <Route path="*" element={<Home />} />
        </Routes>
      </main>
      <Footer />
    </>
  )
}
