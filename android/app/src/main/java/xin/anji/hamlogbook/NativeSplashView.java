package xin.anji.hamlogbook;

import android.content.Context;
import android.graphics.Canvas;
import android.graphics.Color;
import android.graphics.Paint;
import android.graphics.Path;
import android.graphics.RectF;
import android.graphics.Typeface;
import android.view.View;

/**
 * 真正的 Android 原生启动页。使用 Canvas 绘制，体积小且不依赖 WebView、网络或位图资源。
 */
public class NativeSplashView extends View {
    private final String style;
    private final Paint paint = new Paint(Paint.ANTI_ALIAS_FLAG);
    private final float density;

    public NativeSplashView(Context context, String style) {
        super(context);
        this.style = style == null ? "A" : style;
        this.density = getResources().getDisplayMetrics().density;
        setClickable(true);
        setFocusable(true);
        setLayerType(View.LAYER_TYPE_SOFTWARE, null);
    }

    static int getBackgroundColor(String style) {
        if ("B".equals(style)) return Color.rgb(255, 253, 249);
        if ("C".equals(style)) return Color.rgb(247, 245, 240);
        if ("D".equals(style)) return Color.rgb(36, 33, 31);
        if ("E".equals(style)) return Color.rgb(222, 209, 191);
        return Color.rgb(243, 239, 232);
    }

    @Override
    protected void onDraw(Canvas canvas) {
        super.onDraw(canvas);
        canvas.drawColor(getBackgroundColor(style));

        float cx = getWidth() / 2f;
        float cy = getHeight() / 2f - dp(18);
        switch (style) {
            case "B": drawStationCard(canvas, cx, cy); break;
            case "C": drawRadioWave(canvas, cx, cy); break;
            case "D": drawNightStation(canvas, cx, cy); break;
            case "E": drawLogbookPage(canvas, cx, cy); break;
            default: drawPaperAndInk(canvas, cx, cy); break;
        }
    }

    private void drawPaperAndInk(Canvas canvas, float cx, float cy) {
        int accent = Color.rgb(143, 78, 59);
        stroke(accent, 1.2f);
        canvas.drawCircle(cx, cy - dp(44), dp(41), paint);
        canvas.drawOval(new RectF(cx - dp(71), cy - dp(65), cx + dp(71), cy - dp(23)), paint);
        paint.setAlpha(100);
        canvas.drawOval(new RectF(cx - dp(88), cy - dp(72), cx + dp(88), cy - dp(16)), paint);
        paint.setAlpha(255);
        text(canvas, "HAM", cx, cy - dp(37), 21, accent, true);
        commonTitle(canvas, cx, cy + dp(44), accent, "离线通联日志");
    }

    private void drawStationCard(Canvas canvas, float cx, float cy) {
        int ink = Color.rgb(48, 44, 40);
        int border = Color.rgb(203, 189, 171);
        canvas.save();
        canvas.rotate(-2f, cx, cy - dp(35));
        fill(Color.argb(35, 75, 55, 34));
        canvas.drawRoundRect(new RectF(cx - dp(91), cy - dp(83), cx + dp(99), cy + dp(25)), dp(7), dp(7), paint);
        fill(Color.rgb(243, 239, 232));
        canvas.drawRoundRect(new RectF(cx - dp(95), cy - dp(88), cx + dp(95), cy + dp(20)), dp(7), dp(7), paint);
        stroke(border, 1f);
        canvas.drawRoundRect(new RectF(cx - dp(95), cy - dp(88), cx + dp(95), cy + dp(20)), dp(7), dp(7), paint);
        text(canvas, "HAM", cx, cy - dp(38), 27, ink, true);
        text(canvas, "RADIO LOGBOOK", cx, cy - dp(13), 9, ink, false);
        text(canvas, "OFFLINE FIRST", cx + dp(50), cy + dp(7), 7, Color.rgb(143, 78, 59), false);
        canvas.restore();
        commonTitle(canvas, cx, cy + dp(64), ink, "OFFLINE FIRST");
    }

    private void drawRadioWave(Canvas canvas, float cx, float cy) {
        int accent = Color.rgb(167, 93, 70);
        int ink = Color.rgb(79, 74, 67);
        stroke(accent, 1.4f);
        Path wave = new Path();
        wave.moveTo(cx - dp(105), cy - dp(44));
        wave.cubicTo(cx - dp(55), cy - dp(76), cx + dp(55), cy - dp(12), cx + dp(105), cy - dp(44));
        canvas.drawPath(wave, paint);
        paint.setAlpha(85);
        Path wave2 = new Path();
        wave2.moveTo(cx - dp(105), cy - dp(30));
        wave2.cubicTo(cx - dp(55), cy - dp(62), cx + dp(55), cy + dp(2), cx + dp(105), cy - dp(30));
        canvas.drawPath(wave2, paint);
        paint.setAlpha(255);
        fill(getBackgroundColor(style));
        canvas.drawCircle(cx, cy - dp(37), dp(9), paint);
        stroke(accent, 2f);
        canvas.drawCircle(cx, cy - dp(37), dp(9), paint);
        commonTitle(canvas, cx, cy + dp(45), ink, "每一次通联，清晰记录");
    }

    private void drawNightStation(Canvas canvas, float cx, float cy) {
        int accent = Color.rgb(223, 146, 115);
        int title = Color.rgb(240, 232, 221);
        stroke(accent, 1.2f);
        canvas.drawCircle(cx, cy - dp(44), dp(41), paint);
        canvas.drawOval(new RectF(cx - dp(71), cy - dp(65), cx + dp(71), cy - dp(23)), paint);
        paint.setAlpha(90);
        canvas.drawOval(new RectF(cx - dp(88), cy - dp(72), cx + dp(88), cy - dp(16)), paint);
        paint.setAlpha(255);
        text(canvas, "HAM", cx, cy - dp(37), 21, accent, true);
        commonTitle(canvas, cx, cy + dp(44), title, "夜间通联记录");
        text(canvas, "LOCAL · PRIVATE · OFFLINE", cx, getHeight() - dp(42), 8, accent, false);
    }

    private void drawLogbookPage(Canvas canvas, float cx, float cy) {
        int ink = Color.rgb(75, 64, 55);
        int accent = Color.rgb(167, 93, 70);
        fill(Color.argb(35, 75, 64, 55));
        canvas.drawRect(cx - dp(139), cy - dp(129), cx + dp(151), cy + dp(131), paint);
        fill(Color.rgb(248, 240, 223));
        canvas.drawRect(cx - dp(145), cy - dp(135), cx + dp(145), cy + dp(125), paint);
        stroke(Color.rgb(185, 169, 143), 1f);
        canvas.drawRect(cx - dp(145), cy - dp(135), cx + dp(145), cy + dp(125), paint);
        stroke(accent, 1f);
        canvas.drawRect(cx - dp(27), cy - dp(92), cx + dp(27), cy - dp(38), paint);
        text(canvas, "QSO", cx, cy - dp(58), 12, accent, true);
        text(canvas, "HAM LOGBOOK", cx, cy + dp(4), 18, ink, true);
        text(canvas, "记录每一次通联", cx, cy + dp(34), 10, ink, false);
    }

    private void commonTitle(Canvas canvas, float cx, float y, int color, String subtitle) {
        text(canvas, "HAM LOGBOOK", cx, y, 19, color, true);
        text(canvas, subtitle, cx, y + dp(25), 10, color, false);
    }

    private void fill(int color) {
        paint.reset();
        paint.setAntiAlias(true);
        paint.setStyle(Paint.Style.FILL);
        paint.setColor(color);
    }

    private void stroke(int color, float widthDp) {
        paint.reset();
        paint.setAntiAlias(true);
        paint.setStyle(Paint.Style.STROKE);
        paint.setStrokeWidth(dp(widthDp));
        paint.setColor(color);
    }

    private void text(Canvas canvas, String value, float x, float baseline, float sizeSp, int color, boolean serif) {
        paint.reset();
        paint.setAntiAlias(true);
        paint.setColor(color);
        paint.setTextAlign(Paint.Align.CENTER);
        paint.setTextSize(sp(sizeSp));
        paint.setTypeface(Typeface.create(serif ? Typeface.SERIF : Typeface.SANS_SERIF, Typeface.NORMAL));
        canvas.drawText(value, x, baseline, paint);
    }

    private float dp(float value) { return value * density; }
    private float sp(float value) { return value * getResources().getDisplayMetrics().scaledDensity; }
}
