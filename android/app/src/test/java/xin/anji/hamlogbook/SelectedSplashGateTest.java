package xin.anji.hamlogbook;

import org.junit.Test;
import static org.junit.Assert.assertEquals;

public class SelectedSplashGateTest {
    @Test
    public void readyWebPageCannotSkipTheSelectedFrame() {
        SelectedSplashGate gate = new SelectedSplashGate(10000L);
        gate.onPageReady();
        assertEquals(-1L, gate.remainingMillis(10020L));
        gate.onFrameVisible(10500L);
        assertEquals(1000L, gate.remainingMillis(10500L));
        assertEquals(1L, gate.remainingMillis(11499L));
        assertEquals(0L, gate.remainingMillis(11500L));
    }

    @Test
    public void systemStartupTimeDoesNotConsumeSelectedFrameTime() {
        SelectedSplashGate gate = new SelectedSplashGate(0L);
        gate.onPageReady();
        gate.onFrameVisible(1200L);
        assertEquals(1000L, gate.remainingMillis(1200L));
        assertEquals(800L, gate.remainingMillis(1400L));
        assertEquals(0L, gate.remainingMillis(2200L));
    }

    @Test
    public void slowerWebPageDoesNotAddAnotherSecond() {
        SelectedSplashGate gate = new SelectedSplashGate(0L);
        gate.onFrameVisible(200L);
        assertEquals(-1L, gate.remainingMillis(1500L));
        gate.onPageReady();
        assertEquals(0L, gate.remainingMillis(1500L));
    }

    @Test
    public void missingFrameOrPageStillTimesOut() {
        SelectedSplashGate noFrame = new SelectedSplashGate(0L);
        noFrame.onPageReady();
        SelectedSplashGate noPage = new SelectedSplashGate(0L);
        noPage.onFrameVisible(100L);
        for (SelectedSplashGate gate : new SelectedSplashGate[] { noFrame, noPage }) {
            assertEquals(-1L, gate.remainingMillis(3499L));
            assertEquals(0L, gate.remainingMillis(3500L));
        }
    }

    @Test
    public void veryLateFrameCannotExceedOverallTimeout() {
        SelectedSplashGate gate = new SelectedSplashGate(0L);
        gate.onPageReady();
        gate.onFrameVisible(3000L);
        assertEquals(500L, gate.remainingMillis(3000L));
        assertEquals(0L, gate.remainingMillis(3500L));
    }

    @Test
    public void repeatedFrameNotificationDoesNotRestartDuration() {
        SelectedSplashGate gate = new SelectedSplashGate(0L);
        gate.onPageReady();
        gate.onFrameVisible(100L);
        gate.onFrameVisible(600L);
        assertEquals(400L, gate.remainingMillis(700L));
        assertEquals(0L, gate.remainingMillis(1100L));
    }
}
