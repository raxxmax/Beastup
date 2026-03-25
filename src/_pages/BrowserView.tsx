import { useState, useRef, useEffect, useCallback } from "react"

interface BrowserViewProps {
  setView: (view: "queue" | "solutions" | "debug" | "browser") => void
}

const BrowserView: React.FC<BrowserViewProps> = ({ setView }) => {
  const [url, setUrl] = useState("https://www.google.com")
  const [inputUrl, setInputUrl] = useState("https://www.google.com")
  const [isLoading, setIsLoading] = useState(true)
  const [pageTitle, setPageTitle] = useState("Google")
  const webviewRef = useRef<any>(null)

  // Handle webview events
  useEffect(() => {
    const webview = webviewRef.current
    if (!webview) return

    const handleDidStartLoading = () => setIsLoading(true)
    const handleDidStopLoading = () => setIsLoading(false)
    const handleDidNavigate = (e: any) => {
      setInputUrl(e.url)
      setUrl(e.url)
    }
    const handleDidNavigateInPage = (e: any) => {
      if (e.isMainFrame) {
        setInputUrl(e.url)
        setUrl(e.url)
      }
    }
    const handlePageTitleUpdated = (e: any) => {
      setPageTitle(e.title)
    }

    webview.addEventListener("did-start-loading", handleDidStartLoading)
    webview.addEventListener("did-stop-loading", handleDidStopLoading)
    webview.addEventListener("did-navigate", handleDidNavigate)
    webview.addEventListener("did-navigate-in-page", handleDidNavigateInPage)
    webview.addEventListener("page-title-updated", handlePageTitleUpdated)

    return () => {
      webview.removeEventListener("did-start-loading", handleDidStartLoading)
      webview.removeEventListener("did-stop-loading", handleDidStopLoading)
      webview.removeEventListener("did-navigate", handleDidNavigate)
      webview.removeEventListener("did-navigate-in-page", handleDidNavigateInPage)
      webview.removeEventListener("page-title-updated", handlePageTitleUpdated)
    }
  }, [])

  const navigate = useCallback((targetUrl: string) => {
    let processedUrl = targetUrl.trim()
    if (!processedUrl) return

    // Add protocol if missing
    if (!processedUrl.startsWith("http://") && !processedUrl.startsWith("https://")) {
      // Check if it looks like a URL (has a dot) or is a search query
      if (processedUrl.includes(".") && !processedUrl.includes(" ")) {
        processedUrl = "https://" + processedUrl
      } else {
        processedUrl = `https://www.google.com/search?q=${encodeURIComponent(processedUrl)}`
      }
    }

    setUrl(processedUrl)
    setInputUrl(processedUrl)
  }, [])

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault()
    navigate(inputUrl)
  }

  const goBack = () => {
    const webview = webviewRef.current
    if (webview && webview.canGoBack()) {
      webview.goBack()
    }
  }

  const goForward = () => {
    const webview = webviewRef.current
    if (webview && webview.canGoForward()) {
      webview.goForward()
    }
  }

  const reload = () => {
    const webview = webviewRef.current
    if (webview) {
      webview.reload()
    }
  }

  return (
    <div className="flex flex-col h-screen bg-[#0a0a0a] text-white overflow-hidden">
      {/* Browser toolbar */}
      <div className="flex items-center gap-2 px-3 py-2 bg-[#141414] border-b border-white/10 shrink-0 drag-region">
        {/* Navigation buttons */}
        <div className="flex items-center gap-1">
          <button
            onClick={goBack}
            className="p-1.5 rounded-md hover:bg-white/10 transition-colors text-white/60 hover:text-white"
            title="Back"
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M15 18l-6-6 6-6" />
            </svg>
          </button>
          <button
            onClick={goForward}
            className="p-1.5 rounded-md hover:bg-white/10 transition-colors text-white/60 hover:text-white"
            title="Forward"
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M9 18l6-6-6-6" />
            </svg>
          </button>
          <button
            onClick={reload}
            className="p-1.5 rounded-md hover:bg-white/10 transition-colors text-white/60 hover:text-white"
            title="Reload"
          >
            {isLoading ? (
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <line x1="18" y1="6" x2="6" y2="18" />
                <line x1="6" y1="6" x2="18" y2="18" />
              </svg>
            ) : (
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <polyline points="23 4 23 10 17 10" />
                <path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10" />
              </svg>
            )}
          </button>
        </div>

        {/* URL bar */}
        <form onSubmit={handleSubmit} className="flex-1 flex items-center">
          <div className="flex-1 flex items-center bg-[#1e1e1e] rounded-lg border border-white/10 focus-within:border-white/30 transition-colors">
            {/* Lock icon for https */}
            {url.startsWith("https://") && (
              <div className="pl-2.5 text-green-400/70">
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <rect x="3" y="11" width="18" height="11" rx="2" ry="2" />
                  <path d="M7 11V7a5 5 0 0 1 10 0v4" />
                </svg>
              </div>
            )}
            <input
              type="text"
              value={inputUrl}
              onChange={(e) => setInputUrl(e.target.value)}
              onFocus={(e) => e.target.select()}
              className="flex-1 bg-transparent px-2.5 py-1.5 text-sm text-white/90 outline-none placeholder-white/30"
              placeholder="Search or enter URL..."
              spellCheck={false}
            />
            {isLoading && (
              <div className="pr-2.5">
                <div className="w-3 h-3 border-2 border-white/20 border-t-white/60 rounded-full animate-spin" />
              </div>
            )}
          </div>
        </form>

        {/* Close browser button */}
        <button
          onClick={() => setView("queue")}
          className="p-1.5 rounded-md hover:bg-white/10 transition-colors text-white/60 hover:text-white"
          title="Close browser (Ctrl+5)"
        >
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <line x1="18" y1="6" x2="6" y2="18" />
            <line x1="6" y1="6" x2="18" y2="18" />
          </svg>
        </button>
      </div>

      {/* Webview container */}
      <div className="flex-1 overflow-hidden">
        <webview
          ref={webviewRef}
          src={url}
          style={{ width: "100%", height: "100%" }}
          // @ts-ignore - webview is an Electron-specific element
          allowpopups="true"
        />
      </div>
    </div>
  )
}

export default BrowserView
