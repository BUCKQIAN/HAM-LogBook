package xin.anji.hamlogbook;

import android.app.Activity;
import android.content.ContentResolver;
import android.content.Context;
import android.content.Intent;
import android.content.SharedPreferences;
import android.content.UriPermission;
import android.database.Cursor;
import android.net.Uri;
import android.provider.DocumentsContract;

import androidx.activity.result.ActivityResult;

import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.ActivityCallback;
import com.getcapacitor.annotation.CapacitorPlugin;

import java.io.IOException;
import java.io.OutputStream;
import java.nio.charset.StandardCharsets;
import java.util.Map;
import java.util.Locale;
import java.util.UUID;
import java.util.ArrayList;
import java.util.Comparator;
import java.util.List;
import java.util.concurrent.ConcurrentHashMap;

/**
 * 使用 Android Storage Access Framework 选择并持久授权 ADIF 导出目录。
 * 这样导出的文件由用户决定位置，不需要申请整盘存储权限。
 */
@CapacitorPlugin(name = "AdifFileManager")
public class AdifFileManagerPlugin extends Plugin {
    private static final String PREFS_NAME = "hamlog_adif_export";
    private static final String URI_KEY = "folder_uri";
    private static final String NAME_KEY = "folder_name";
    private static final String ADIF_MIME_TYPE = "text/plain";
    private static final String JSON_MIME_TYPE = "application/json";
    private final Map<String, ExportSession> exportSessions = new ConcurrentHashMap<>();

    private static class ExportSession {
        final OutputStream output;
        final Uri uri;
        final String filename;
        final String folderName;

        ExportSession(OutputStream output, Uri uri, String filename, String folderName) {
            this.output = output;
            this.uri = uri;
            this.filename = filename;
            this.folderName = folderName;
        }

        synchronized void append(String content) throws IOException {
            output.write(content.getBytes(StandardCharsets.UTF_8));
        }

        synchronized void close() throws IOException {
            output.flush();
            output.close();
        }
    }

    private static class ExportFile {
        final Uri uri;
        final String filename;

        ExportFile(Uri uri, String filename) {
            this.uri = uri;
            this.filename = filename;
        }
    }

    @PluginMethod
    public void chooseExportFolder(PluginCall call) {
        Intent intent = new Intent(Intent.ACTION_OPEN_DOCUMENT_TREE);
        intent.addFlags(
            Intent.FLAG_GRANT_READ_URI_PERMISSION |
            Intent.FLAG_GRANT_WRITE_URI_PERMISSION |
            Intent.FLAG_GRANT_PERSISTABLE_URI_PERMISSION |
            Intent.FLAG_GRANT_PREFIX_URI_PERMISSION
        );
        startActivityForResult(call, intent, "folderChosen");
    }

    @ActivityCallback
    private void folderChosen(PluginCall call, ActivityResult result) {
        if (call == null) return;

        Intent data = result.getData();
        if (result.getResultCode() != Activity.RESULT_OK || data == null || data.getData() == null) {
            JSObject response = new JSObject();
            response.put("selected", false);
            response.put("cancelled", true);
            call.resolve(response);
            return;
        }

        Uri treeUri = data.getData();
        int grantedFlags = data.getFlags();
        if ((grantedFlags & Intent.FLAG_GRANT_WRITE_URI_PERMISSION) == 0) {
            call.reject("所选文件夹没有写入权限，请选择其他文件夹");
            return;
        }

        try {
            // 分开持久化明确的权限常量，避免把 Activity 返回的其他 flags 传入 ContentResolver。
            getContext().getContentResolver().takePersistableUriPermission(
                treeUri,
                Intent.FLAG_GRANT_WRITE_URI_PERMISSION
            );
            if ((grantedFlags & Intent.FLAG_GRANT_READ_URI_PERMISSION) != 0) {
                getContext().getContentResolver().takePersistableUriPermission(
                    treeUri,
                    Intent.FLAG_GRANT_READ_URI_PERMISSION
                );
            }
            String folderName = resolveFolderName(treeUri);
            preferences().edit()
                .putString(URI_KEY, treeUri.toString())
                .putString(NAME_KEY, folderName)
                .apply();
            call.resolve(folderResponse(treeUri, folderName));
        } catch (SecurityException error) {
            call.reject("无法保存该文件夹的访问权限，请重新选择", error);
        }
    }

    @PluginMethod
    public void getExportFolder(PluginCall call) {
        Uri treeUri = getSavedTreeUri();
        if (treeUri == null || !hasPersistedWritePermission(treeUri)) {
            clearSavedFolder();
            JSObject response = new JSObject();
            response.put("selected", false);
            call.resolve(response);
            return;
        }

        String folderName = preferences().getString(NAME_KEY, "已选择的文件夹");
        call.resolve(folderResponse(treeUri, folderName));
    }

    @PluginMethod
    public void exportAdif(PluginCall call) {
        exportTextFile(call, ".adi", ADIF_MIME_TYPE);
    }

    @PluginMethod
    public void exportPersonalInfo(PluginCall call) {
        exportTextFile(call, ".json", JSON_MIME_TYPE);
    }

    /** 开始大型 ADIF 分块导出，避免把全部日志一次性跨 JS/Native 桥传输。 */
    @PluginMethod
    public void beginAdifExport(PluginCall call) {
        String filename = sanitizeFilename(call.getString("filename"), ".adi");
        String initialContent = call.getString("content", "");
        if (filename == null) {
            call.reject("导出文件名无效");
            return;
        }

        Uri treeUri = getSavedTreeUri();
        if (treeUri == null || !hasPersistedWritePermission(treeUri)) {
            clearSavedFolder();
            call.reject("尚未选择导出文件夹，或文件夹授权已失效");
            return;
        }

        OutputStream output = null;
        Uri fileUri = null;
        try {
            ExportFile exportFile = createUniqueExportFile(treeUri, filename, ADIF_MIME_TYPE);
            fileUri = exportFile.uri;
            output = getContext().getContentResolver().openOutputStream(fileUri, "wt");
            if (output == null) throw new IOException("无法打开目标文件");

            String sessionId = UUID.randomUUID().toString();
            ExportSession session = new ExportSession(
                output,
                fileUri,
                exportFile.filename,
                preferences().getString(NAME_KEY, "已选择的文件夹")
            );
            session.append(initialContent);
            exportSessions.put(sessionId, session);

            JSObject response = fileResponse(session);
            response.put("sessionId", sessionId);
            call.resolve(response);
        } catch (SecurityException error) {
            closeQuietly(output);
            deleteQuietly(fileUri);
            clearSavedFolder();
            call.reject("导出文件夹授权已失效，请重新选择", error);
        } catch (Exception error) {
            closeQuietly(output);
            deleteQuietly(fileUri);
            call.reject("开始导出失败：" + safeMessage(error), error);
        }
    }

    @PluginMethod
    public void appendAdifExport(PluginCall call) {
        String sessionId = call.getString("sessionId");
        String content = call.getString("content");
        ExportSession session = sessionId == null ? null : exportSessions.get(sessionId);
        if (session == null) {
            call.reject("导出会话不存在或已失效");
            return;
        }
        if (content == null) {
            call.reject("导出内容为空");
            return;
        }

        try {
            session.append(content);
            JSObject response = new JSObject();
            response.put("written", true);
            call.resolve(response);
        } catch (Exception error) {
            exportSessions.remove(sessionId);
            closeQuietly(session.output);
            deleteQuietly(session.uri);
            call.reject("写入导出分块失败：" + safeMessage(error), error);
        }
    }

    @PluginMethod
    public void finishAdifExport(PluginCall call) {
        String sessionId = call.getString("sessionId");
        ExportSession session = sessionId == null ? null : exportSessions.remove(sessionId);
        if (session == null) {
            call.reject("导出会话不存在或已失效");
            return;
        }
        try {
            session.close();
            call.resolve(fileResponse(session));
        } catch (Exception error) {
            closeQuietly(session.output);
            deleteQuietly(session.uri);
            call.reject("完成导出失败：" + safeMessage(error), error);
        }
    }

    @PluginMethod
    public void abortAdifExport(PluginCall call) {
        String sessionId = call.getString("sessionId");
        ExportSession session = sessionId == null ? null : exportSessions.remove(sessionId);
        if (session != null) {
            closeQuietly(session.output);
            deleteQuietly(session.uri);
        }
        JSObject response = new JSObject();
        response.put("aborted", true);
        call.resolve(response);
    }

    /** 自动备份只保留最近若干份，仅匹配应用自己的固定文件名前缀。 */
    @PluginMethod
    public void pruneAutomaticBackups(PluginCall call) {
        int keep = Math.max(1, Math.min(call.getInt("keep", 7), 30));
        Uri treeUri = getSavedTreeUri();
        if (treeUri == null || !hasPersistedWritePermission(treeUri)) {
            call.reject("自动备份文件夹授权已失效");
            return;
        }
        try {
            List<BackupDocument> documents = listAutomaticBackups(treeUri);
            documents.sort(Comparator.comparing(item -> item.name, Comparator.reverseOrder()));
            int deleted = 0;
            for (int index = keep; index < documents.size(); index++) {
                if (DocumentsContract.deleteDocument(getContext().getContentResolver(), documents.get(index).uri)) {
                    deleted++;
                }
            }
            JSObject result = new JSObject();
            result.put("deleted", deleted);
            result.put("kept", Math.min(keep, documents.size()));
            call.resolve(result);
        } catch (Exception error) {
            call.reject("清理旧自动备份失败：" + safeMessage(error), error);
        }
    }

    private static class BackupDocument {
        final String name;
        final Uri uri;

        BackupDocument(String name, Uri uri) {
            this.name = name;
            this.uri = uri;
        }
    }

    private List<BackupDocument> listAutomaticBackups(Uri treeUri) throws Exception {
        List<BackupDocument> result = new ArrayList<>();
        String parentId = DocumentsContract.getTreeDocumentId(treeUri);
        Uri childrenUri = DocumentsContract.buildChildDocumentsUriUsingTree(treeUri, parentId);
        String[] columns = {
            DocumentsContract.Document.COLUMN_DOCUMENT_ID,
            DocumentsContract.Document.COLUMN_DISPLAY_NAME,
            DocumentsContract.Document.COLUMN_MIME_TYPE
        };
        try (Cursor cursor = getContext().getContentResolver().query(childrenUri, columns, null, null, null)) {
            if (cursor == null) return result;
            int idColumn = cursor.getColumnIndexOrThrow(DocumentsContract.Document.COLUMN_DOCUMENT_ID);
            int nameColumn = cursor.getColumnIndexOrThrow(DocumentsContract.Document.COLUMN_DISPLAY_NAME);
            int mimeColumn = cursor.getColumnIndexOrThrow(DocumentsContract.Document.COLUMN_MIME_TYPE);
            while (cursor.moveToNext()) {
                String name = cursor.getString(nameColumn);
                String mimeType = cursor.getString(mimeColumn);
                if (name != null
                    && name.matches("ham-logbook-auto_\\d{8}(?:-\\d+)?\\.adi")
                    && !DocumentsContract.Document.MIME_TYPE_DIR.equals(mimeType)) {
                    Uri uri = DocumentsContract.buildDocumentUriUsingTree(treeUri, cursor.getString(idColumn));
                    result.add(new BackupDocument(name, uri));
                }
            }
        }
        return result;
    }

    private void exportTextFile(PluginCall call, String requiredExtension, String mimeType) {
        String filename = sanitizeFilename(call.getString("filename"), requiredExtension);
        String content = call.getString("content");
        if (filename == null) {
            call.reject("导出文件名无效");
            return;
        }
        if (content == null) {
            call.reject("文件内容为空");
            return;
        }

        Uri treeUri = getSavedTreeUri();
        if (treeUri == null || !hasPersistedWritePermission(treeUri)) {
            clearSavedFolder();
            call.reject("尚未选择导出文件夹，或文件夹授权已失效");
            return;
        }

        Uri fileUri = null;
        try {
            ExportFile exportFile = createUniqueExportFile(treeUri, filename, mimeType);
            fileUri = exportFile.uri;
            writeUtf8(fileUri, content);
            JSObject response = new JSObject();
            response.put("uri", fileUri.toString());
            response.put("filename", exportFile.filename);
            response.put("folderName", preferences().getString(NAME_KEY, "已选择的文件夹"));
            call.resolve(response);
        } catch (SecurityException error) {
            deleteQuietly(fileUri);
            clearSavedFolder();
            call.reject("导出文件夹授权已失效，请重新选择", error);
        } catch (Exception error) {
            deleteQuietly(fileUri);
            call.reject("写入文件失败：" + safeMessage(error), error);
        }
    }

    private SharedPreferences preferences() {
        return getContext().getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE);
    }

    private Uri getSavedTreeUri() {
        String value = preferences().getString(URI_KEY, null);
        if (value == null || value.isEmpty()) return null;
        try {
            return Uri.parse(value);
        } catch (Exception error) {
            return null;
        }
    }

    private void clearSavedFolder() {
        preferences().edit().remove(URI_KEY).remove(NAME_KEY).apply();
    }

    private boolean hasPersistedWritePermission(Uri treeUri) {
        for (UriPermission permission : getContext().getContentResolver().getPersistedUriPermissions()) {
            if (treeUri.equals(permission.getUri()) && permission.isWritePermission()) return true;
        }
        return false;
    }

    private JSObject folderResponse(Uri treeUri, String folderName) {
        JSObject response = new JSObject();
        response.put("selected", true);
        response.put("uri", treeUri.toString());
        response.put("name", folderName);
        return response;
    }

    private String resolveFolderName(Uri treeUri) {
        ContentResolver resolver = getContext().getContentResolver();
        try {
            Uri documentUri = DocumentsContract.buildDocumentUriUsingTree(
                treeUri,
                DocumentsContract.getTreeDocumentId(treeUri)
            );
            try (Cursor cursor = resolver.query(
                documentUri,
                new String[] { DocumentsContract.Document.COLUMN_DISPLAY_NAME },
                null,
                null,
                null
            )) {
                if (cursor != null && cursor.moveToFirst()) {
                    String name = cursor.getString(0);
                    if (name != null && !name.trim().isEmpty()) return name.trim();
                }
            }
        } catch (Exception ignored) {
            // 部分文档提供器不支持查询根目录名称，下面使用 documentId 兜底。
        }

        try {
            String documentId = DocumentsContract.getTreeDocumentId(treeUri);
            int slash = documentId.lastIndexOf('/');
            String name = slash >= 0 ? documentId.substring(slash + 1) : documentId;
            int colon = name.lastIndexOf(':');
            if (colon >= 0) name = name.substring(colon + 1);
            return name.isEmpty() ? "内部存储" : name;
        } catch (Exception ignored) {
            return "已选择的文件夹";
        }
    }

    private Uri findDocument(Uri treeUri, String filename) {
        ContentResolver resolver = getContext().getContentResolver();
        String parentId = DocumentsContract.getTreeDocumentId(treeUri);
        Uri childrenUri = DocumentsContract.buildChildDocumentsUriUsingTree(treeUri, parentId);
        String[] columns = {
            DocumentsContract.Document.COLUMN_DOCUMENT_ID,
            DocumentsContract.Document.COLUMN_DISPLAY_NAME,
            DocumentsContract.Document.COLUMN_MIME_TYPE
        };

        try (Cursor cursor = resolver.query(childrenUri, columns, null, null, null)) {
            if (cursor == null) return null;
            int idColumn = cursor.getColumnIndexOrThrow(DocumentsContract.Document.COLUMN_DOCUMENT_ID);
            int nameColumn = cursor.getColumnIndexOrThrow(DocumentsContract.Document.COLUMN_DISPLAY_NAME);
            int mimeColumn = cursor.getColumnIndexOrThrow(DocumentsContract.Document.COLUMN_MIME_TYPE);
            while (cursor.moveToNext()) {
                String name = cursor.getString(nameColumn);
                String mimeType = cursor.getString(mimeColumn);
                if (filename.equals(name) && !DocumentsContract.Document.MIME_TYPE_DIR.equals(mimeType)) {
                    return DocumentsContract.buildDocumentUriUsingTree(treeUri, cursor.getString(idColumn));
                }
            }
        } catch (Exception ignored) {
            // 部分云盘提供器不允许枚举目录；仍尝试由系统创建新文件。
            return null;
        }
        return null;
    }

    private void writeUtf8(Uri fileUri, String content) throws IOException {
        try (OutputStream output = getContext().getContentResolver().openOutputStream(fileUri, "wt")) {
            if (output == null) throw new IOException("无法打开目标文件");
            output.write(content.getBytes(StandardCharsets.UTF_8));
            output.flush();
        }
    }

    /** 始终创建新文件，绝不截断用户已有的同名备份。 */
    private ExportFile createUniqueExportFile(Uri treeUri, String filename, String mimeType) throws IOException {
        Uri parentUri = DocumentsContract.buildDocumentUriUsingTree(
            treeUri,
            DocumentsContract.getTreeDocumentId(treeUri)
        );
        int dot = filename.lastIndexOf('.');
        String base = dot > 0 ? filename.substring(0, dot) : filename;
        String extension = dot > 0 ? filename.substring(dot) : "";

        for (int index = 0; index <= 999; index++) {
            String candidate = index == 0 ? filename : base + "-" + index + extension;
            if (findDocument(treeUri, candidate) != null) continue;
            Uri fileUri = DocumentsContract.createDocument(
                getContext().getContentResolver(),
                parentUri,
                mimeType,
                candidate
            );
            if (fileUri != null) return new ExportFile(fileUri, candidate);
        }
        throw new IOException("同名导出文件过多，请更换导出文件夹");
    }

    private JSObject fileResponse(ExportSession session) {
        JSObject response = new JSObject();
        response.put("uri", session.uri.toString());
        response.put("filename", session.filename);
        response.put("folderName", session.folderName);
        return response;
    }

    private void closeQuietly(OutputStream output) {
        if (output == null) return;
        try { output.close(); }
        catch (IOException ignored) { }
    }

    private void deleteQuietly(Uri fileUri) {
        if (fileUri == null) return;
        try { DocumentsContract.deleteDocument(getContext().getContentResolver(), fileUri); }
        catch (Exception ignored) { }
    }

    @Override
    protected void handleOnDestroy() {
        for (ExportSession session : exportSessions.values()) {
            closeQuietly(session.output);
            deleteQuietly(session.uri);
        }
        exportSessions.clear();
        super.handleOnDestroy();
    }

    private String sanitizeFilename(String filename, String requiredExtension) {
        if (filename == null) return null;
        String value = filename.trim();
        if (value.isEmpty() || value.contains("/") || value.contains("\\") || value.contains("..")) return null;
        return value.toLowerCase(Locale.ROOT).endsWith(requiredExtension) ? value : value + requiredExtension;
    }

    private String safeMessage(Exception error) {
        String message = error.getMessage();
        return message == null || message.trim().isEmpty() ? "未知错误" : message;
    }
}
