import { useEffect } from 'react'
import { Navigate, Route, Routes, useLocation } from 'react-router-dom'
import Header from './components/Header'
import Footer from './components/Footer'
import Home from './pages/Home'
import Markets from './pages/Markets'
import Launch from './pages/Launch'
import Token from './pages/Token'
import Stocks from './pages/Stocks'
import Portfolio from './pages/Portfolio'
import Docs from './pages/Docs'
import Ops from './pages/Ops'
import SimCheck from './pages/SimCheck'

export default function App() {
  const { pathname, hash } = useLocation()
  const ops = pathname === '/' && hash === '#ops'
  useEffect(() => {
    if (!hash || ops) window.scrollTo(0, 0)
  }, [pathname, hash, ops])

  return (
    <>
      <Header />
      <main>
        <Routes>
          <Route path="/" element={ops ? <Ops /> : <Home />} />
          <Route path="/__sim" element={<SimCheck />} />
          <Route path="/markets" element={<Markets />} />
          <Route path="/board" element={<Navigate to="/markets" replace />} />
          <Route path="/launch" element={<Launch />} />
          <Route path="/coin/:id" element={<Token />} />
          <Route path="/stocks" element={<Stocks />} />
          <Route path="/portfolio" element={<Portfolio />} />
          <Route path="/profile" element={<Navigate to="/portfolio" replace />} />
          <Route path="/docs" element={<Docs />} />
          <Route path="*" element={<Home />} />
        </Routes>
      </main>
      <Footer />
    </>
  )
}
