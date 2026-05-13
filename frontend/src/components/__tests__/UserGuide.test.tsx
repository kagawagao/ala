import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, screen, cleanup, waitFor } from '@testing-library/react'
import UserGuide from '../UserGuide'

// Replace react-markdown with a simple passthrough so we can inspect content in jsdom.
vi.mock('react-markdown', () => ({
  default: ({ children }: { children: string }) => (
    <div data-testid="markdown-content">{children}</div>
  ),
}))

vi.mock('remark-gfm', () => ({ default: () => {} }))

// Use vi.hoisted so the mutable language reference is available when vi.mock runs.
const mockLang = vi.hoisted(() => ({ current: 'en' }))

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string) => key,
    i18n: { language: mockLang.current },
  }),
}))

/** Returns a mock fetch that resolves with the given markdown text. */
function mockSuccessfulFetch(text: string) {
  return vi.fn().mockResolvedValue({ ok: true, text: () => Promise.resolve(text) })
}

describe('UserGuide', () => {
  afterEach(() => {
    cleanup()
    vi.unstubAllGlobals()
    mockLang.current = 'en'
  })

  // Test 1 – loading state (en, cache empty on first run)
  it('shows a loading indicator while the guide file is being fetched', () => {
    // fetch returns a promise that never settles so the component stays in loading state
    vi.stubGlobal(
      'fetch',
      vi.fn(() => new Promise(() => {})),
    )

    render(<UserGuide />)

    // Neither content nor error should be visible during loading
    expect(screen.queryByTestId('markdown-content')).toBeNull()
    expect(screen.queryByText('guideLoadError')).toBeNull()
    // The Ant Design Spin component is the only child rendered in loading state
    expect(document.querySelector('.ant-spin')).toBeInTheDocument()
  })

  // Test 2 – error state (en still uncached; test 1's fetch never resolved)
  it('shows an error message when the guide file cannot be loaded', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false, statusText: 'Not Found' }))

    render(<UserGuide />)

    await waitFor(() => {
      expect(screen.getByText('guideLoadError')).toBeInTheDocument()
    })
    expect(screen.queryByTestId('markdown-content')).toBeNull()
  })

  // Test 3 – success state (zh, uncached; after this test 'zh' is cached)
  it('renders markdown content after the guide file loads successfully', async () => {
    mockLang.current = 'zh'
    vi.stubGlobal('fetch', mockSuccessfulFetch('# 用户指南\n\n欢迎使用 ALA。'))

    render(<UserGuide />)

    await waitFor(() => {
      expect(screen.getByTestId('markdown-content')).toBeInTheDocument()
    })
    expect(screen.getByTestId('markdown-content').textContent).toContain('# 用户指南')
  })

  // Test 4 – AbortError must not trigger the error state (en still uncached)
  it('does not show an error when the fetch is cancelled (AbortError)', async () => {
    // Use DOMException with 'AbortError' name – the standard abort signal error.
    vi.stubGlobal(
      'fetch',
      vi.fn().mockRejectedValue(new DOMException('The user aborted a request.', 'AbortError')),
    )
    const fetchMock = vi.mocked(globalThis.fetch)

    render(<UserGuide />)

    // Wait until fetch has been invoked and its rejection has propagated.
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1))

    expect(screen.queryByText('guideLoadError')).toBeNull()
    // Component remains in the loading/spinner state (content is null, no error set)
    expect(document.querySelector('.ant-spin')).toBeInTheDocument()
  })

  // Test 5 – cache hit: 'zh' was cached in test 3 so fetch must not be called again
  it('serves content from cache on re-render without calling fetch again', () => {
    mockLang.current = 'zh'
    const fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)

    render(<UserGuide />)

    expect(screen.getByTestId('markdown-content')).toBeInTheDocument()
    expect(fetchMock).not.toHaveBeenCalled()
  })

  // Test 6 – verify the URL contains the correct language segment (en still uncached)
  it('fetches the guide file that corresponds to the active language', async () => {
    const fetchMock = mockSuccessfulFetch('# English Guide')
    vi.stubGlobal('fetch', fetchMock)

    render(<UserGuide />)

    await waitFor(() => {
      expect(screen.getByTestId('markdown-content')).toBeInTheDocument()
    })
    expect(fetchMock).toHaveBeenCalledWith(
      '/guide/en.md',
      expect.objectContaining({ signal: expect.any(AbortSignal) }),
    )
  })
})
