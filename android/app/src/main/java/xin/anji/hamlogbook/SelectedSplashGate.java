package xin.anji.hamlogbook;

/** 启动页退出条件：完整画面已可见、网页已就绪，且完成最短展示；异常启动有总超时。 */
final class SelectedSplashGate {
    static final long MIN_VISIBLE_MS = 1000L;
    static final long TIMEOUT_MS = 3500L;

    private final long startedAtMs;
    private long visibleAtMs = -1L;
    private boolean pageReady;

    SelectedSplashGate(long startedAtMs) {
        this.startedAtMs = startedAtMs;
    }

    void onFrameVisible(long nowMs) {
        if (visibleAtMs < 0L) visibleAtMs = nowMs;
    }

    void onPageReady() {
        pageReady = true;
    }

    /** -1 表示等待画面或网页；0 表示可以退出；正数为剩余展示时间。 */
    long remainingMillis(long nowMs) {
        long timeoutRemaining = Math.max(0L, TIMEOUT_MS - (nowMs - startedAtMs));
        if (timeoutRemaining == 0L) return 0L;
        if (!pageReady || visibleAtMs < 0L) return -1L;
        long visibleRemaining = Math.max(0L, MIN_VISIBLE_MS - (nowMs - visibleAtMs));
        return Math.min(timeoutRemaining, visibleRemaining);
    }
}
