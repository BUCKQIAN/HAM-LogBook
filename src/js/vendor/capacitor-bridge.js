/* ============================================================
   capacitor-bridge.js - 全局插件桥接（ES 模块，通过 window 共享）
   包含完整 SQLiteConnection/SQLiteDBConnection 实现
   ============================================================ */
(function() {
'use strict';
var cap = window.Capacitor || {};
var plugins = cap.Plugins || {};

// ===== CapacitorSQLite (从原生桥接获取) =====
window.CapacitorSQLite = plugins.CapacitorSQLite || {};

// ===== SQLiteDBConnection 类 (从 @capacitor-community/sqlite 原版复制) =====
window.SQLiteDBConnection = function(dbName, readonly, sqlite) {
    this.dbName = dbName;
    this.readonly = readonly;
    this.sqlite = sqlite;
};
window.SQLiteDBConnection.prototype.getConnectionDBName = function() { return this.dbName; };
window.SQLiteDBConnection.prototype.getConnectionReadOnly = function() { return this.readonly; };
window.SQLiteDBConnection.prototype.open = function() {
    var self = this;
    return self.sqlite.open({ database: self.dbName, readonly: self.readonly });
};
window.SQLiteDBConnection.prototype.close = function() {
    var self = this;
    return self.sqlite.close({ database: self.dbName, readonly: self.readonly });
};
window.SQLiteDBConnection.prototype.execute = function(statements) {
    var self = this;
    if (self.readonly) return Promise.reject('not allowed in read-only mode');
    return self.sqlite.execute({ database: self.dbName, statements: statements, transaction: true, readonly: false, isSQL92: true });
};
window.SQLiteDBConnection.prototype.run = function(statement, values) {
    var self = this;
    if (self.readonly) return Promise.reject('not allowed in read-only mode');
    return self.sqlite.run({ database: self.dbName, statement: statement, values: values || [], transaction: true, readonly: false, returnMode: 'no', isSQL92: true });
};
window.SQLiteDBConnection.prototype.query = function(statement, values) {
    var self = this;
    return self.sqlite.query({ database: self.dbName, statement: statement, values: values || [], readonly: self.readonly, isSQL92: true });
};
window.SQLiteDBConnection.prototype.isDBOpen = function() {
    var self = this;
    return self.sqlite.isDBOpen({ database: self.dbName, readonly: self.readonly });
};
window.SQLiteDBConnection.prototype.delete = function() {
    var self = this;
    if (self.readonly) return Promise.reject('not allowed in read-only mode');
    return self.sqlite.deleteDatabase({ database: self.dbName, readonly: false });
};
window.SQLiteDBConnection.prototype.isExists = function() {
    var self = this;
    return self.sqlite.isDBExists({ database: self.dbName, readonly: self.readonly });
};
window.SQLiteDBConnection.prototype.createSyncTable = function() {
    var self = this;
    if (self.readonly) return Promise.reject('not allowed in read-only mode');
    return self.sqlite.createSyncTable({ database: self.dbName, readonly: false });
};
window.SQLiteDBConnection.prototype.setSyncDate = function(syncdate) {
    var self = this;
    if (self.readonly) return Promise.reject('not allowed in read-only mode');
    return self.sqlite.setSyncDate({ database: self.dbName, syncdate: syncdate, readonly: false });
};
window.SQLiteDBConnection.prototype.getSyncDate = function() {
    var self = this;
    return self.sqlite.getSyncDate({ database: self.dbName, readonly: self.readonly });
};
window.SQLiteDBConnection.prototype.getVersion = function() {
    var self = this;
    return self.sqlite.getVersion({ database: self.dbName, readonly: self.readonly });
};
window.SQLiteDBConnection.prototype.getTableList = function() {
    var self = this;
    return self.sqlite.getTableList({ database: self.dbName, readonly: self.readonly });
};

// ===== SQLiteConnection 类 (从 @capacitor-community/sqlite 原版复制) =====
window.SQLiteConnection = function(sqlite) {
    this.sqlite = sqlite;
    this._connectionDict = new Map();
};
window.SQLiteConnection.prototype.initWebStore = function() { return this.sqlite.initWebStore(); };
window.SQLiteConnection.prototype.saveToStore = function(database) { return this.sqlite.saveToStore({ database: database }); };
window.SQLiteConnection.prototype.saveToLocalDisk = function(database) { return this.sqlite.saveToLocalDisk({ database: database }); };
window.SQLiteConnection.prototype.echo = function(value) { return this.sqlite.echo({ value: value }); };
window.SQLiteConnection.prototype.isSecretStored = function() { return this.sqlite.isSecretStored(); };
window.SQLiteConnection.prototype.setEncryptionSecret = function(passphrase) { return this.sqlite.setEncryptionSecret({ passphrase: passphrase }); };
window.SQLiteConnection.prototype.changeEncryptionSecret = function(passphrase, oldpassphrase) { return this.sqlite.changeEncryptionSecret({ passphrase: passphrase, oldpassphrase: oldpassphrase }); };
window.SQLiteConnection.prototype.clearEncryptionSecret = function() { return this.sqlite.clearEncryptionSecret(); };
window.SQLiteConnection.prototype.checkEncryptionSecret = function(passphrase) { return this.sqlite.checkEncryptionSecret({ passphrase: passphrase }); };

window.SQLiteConnection.prototype.createConnection = function(database, encrypted, mode, version, readonly) {
    var self = this;
    var db = database;
    if (db && db.endsWith && db.endsWith('.db')) db = db.slice(0, -3);
    console.log('Bridge createConnection:', db, encrypted, mode, version, readonly);
    return self.sqlite.createConnection({ database: db, encrypted: encrypted, mode: mode, version: version, readonly: readonly })
    .then(function(res) {
        console.log('Bridge createConnection OK, result:', JSON.stringify(res));
        var conn = new window.SQLiteDBConnection(db, readonly, self.sqlite);
        var connName = readonly ? 'RO_' + db : 'RW_' + db;
        self._connectionDict.set(connName, conn);
        return Promise.resolve(conn);
    })
    .catch(function(err) {
        console.error('Bridge createConnection FAILED:', err, typeof err, JSON.stringify(err));
        throw err;
    });
};
window.SQLiteConnection.prototype.closeConnection = function(database, readonly) {
    var self = this;
    var db = database;
    if (db && db.endsWith && db.endsWith('.db')) db = db.slice(0, -3);
    return self.sqlite.closeConnection({ database: db, readonly: readonly }).then(function() {
        var connName = readonly ? 'RO_' + db : 'RW_' + db;
        self._connectionDict.delete(connName);
    });
};
window.SQLiteConnection.prototype.isConnection = function(database, readonly) {
    var self = this;
    var db = database;
    if (db && db.endsWith && db.endsWith('.db')) db = db.slice(0, -3);
    var connName = readonly ? 'RO_' + db : 'RW_' + db;
    return Promise.resolve({ result: self._connectionDict.has(connName) });
};
window.SQLiteConnection.prototype.retrieveConnection = function(database, readonly) {
    var self = this;
    var db = database;
    if (db && db.endsWith && db.endsWith('.db')) db = db.slice(0, -3);
    var connName = readonly ? 'RO_' + db : 'RW_' + db;
    if (self._connectionDict.has(connName)) {
        var conn = self._connectionDict.get(connName);
        return conn ? Promise.resolve(conn) : Promise.reject('Connection ' + db + ' is undefined');
    }
    return Promise.reject('Connection ' + db + ' does not exist');
};
window.SQLiteConnection.prototype.retrieveAllConnections = function() { return this._connectionDict; };
window.SQLiteConnection.prototype.closeAllConnections = function() {
    var self = this;
    var promises = [];
    self._connectionDict.forEach(function(_, key) {
        var db = key.substring(3);
        var ro = key.substring(0, 3) === 'RO_';
        promises.push(self.sqlite.closeConnection({ database: db, readonly: ro }));
    });
    return Promise.all(promises).then(function() { self._connectionDict.clear(); });
};
window.SQLiteConnection.prototype.importFromJson = function(jsonstring) { return this.sqlite.importFromJson({ jsonstring: jsonstring }); };
window.SQLiteConnection.prototype.isJsonValid = function(jsonstring) { return this.sqlite.isJsonValid({ jsonstring: jsonstring }); };
window.SQLiteConnection.prototype.copyFromAssets = function(overwrite) { return this.sqlite.copyFromAssets({ overwrite: overwrite != null ? overwrite : true }); };
window.SQLiteConnection.prototype.isDatabase = function(database) { return this.sqlite.isDatabase({ database: database }); };
window.SQLiteConnection.prototype.getDatabaseList = function() { return this.sqlite.getDatabaseList(); };
window.SQLiteConnection.prototype.addSQLiteSuffix = function(folderPath, dbNameList) { return this.sqlite.addSQLiteSuffix({ folderPath: folderPath || 'default', dbNameList: dbNameList || [] }); };
window.SQLiteConnection.prototype.deleteOldDatabases = function(folderPath, dbNameList) { return this.sqlite.deleteOldDatabases({ folderPath: folderPath || 'default', dbNameList: dbNameList || [] }); };
window.SQLiteConnection.prototype.checkConnectionsConsistency = function() { return this.sqlite.checkConnectionsConsistency({ dbNames: [], openModes: [] }); };
window.SQLiteConnection.prototype.isDatabaseEncrypted = function(database) { return this.sqlite.isDatabaseEncrypted({ database: database }); };
window.SQLiteConnection.prototype.isInConfigEncryption = function() { return this.sqlite.isInConfigEncryption(); };
window.SQLiteConnection.prototype.isInConfigBiometricAuth = function() { return this.sqlite.isInConfigBiometricAuth(); };
window.SQLiteConnection.prototype.getNCDatabasePath = function(path, database) { return this.sqlite.getNCDatabasePath({ path: path, database: database }); };
window.SQLiteConnection.prototype.createNCConnection = function(databasePath, version) {
    var self = this;
    return self.sqlite.createNCConnection({ databasePath: databasePath, version: version }).then(function() {
        var conn = new window.SQLiteDBConnection(databasePath, true, self.sqlite);
        self._connectionDict.set('RO_' + databasePath + ')', conn);
        return Promise.resolve(conn);
    });
};
window.SQLiteConnection.prototype.closeNCConnection = function(databasePath) {
    var self = this;
    return self.sqlite.closeNCConnection({ databasePath: databasePath }).then(function() {
        self._connectionDict.delete('RO_' + databasePath + ')');
    });
};

// ===== 其他插件 =====
window.GeolocationPlugin = plugins.Geolocation || null;
window.FilesystemPlugin = plugins.Filesystem || {};
window.SharePlugin = plugins.Share || {};
window.FilesystemDirectory = { Documents: 'DOCUMENTS', Data: 'DATA', Cache: 'CACHE', External: 'EXTERNAL', ExternalStorage: 'EXTERNAL_STORAGE' };
window.FilesystemEncoding = { UTF8: 'utf8', ASCII: 'ascii', UTF16: 'utf16' };

	// 验证 Filesystem 插件核心方法（不可用时提供明确报错）
	if (!window.FilesystemPlugin.mkdir || !window.FilesystemPlugin.writeFile) {
	  console.warn('Filesystem plugin missing methods');
	  window.FilesystemPlugin.mkdir = window.FilesystemPlugin.mkdir || function() {
	    return Promise.reject(new Error('文件系统不可用，请授予存储权限后重试'));
	  };
	  window.FilesystemPlugin.writeFile = window.FilesystemPlugin.writeFile || function() {
	    return Promise.reject(new Error('文件系统不可用，请授予存储权限后重试'));
	  };
	}

console.log('Capacitor bridge ready');
})();

// ===== 诊断信息 =====
window._bridgeDiag = {
  capacitorAvailable: !!window.Capacitor,
  pluginsAvailable: !!(window.Capacitor && window.Capacitor.Plugins),
  sqliteAvailable: !!(window.Capacitor && window.Capacitor.Plugins && window.Capacitor.Plugins.CapacitorSQLite),
  geolocationAvailable: !!(window.Capacitor && window.Capacitor.Plugins && window.Capacitor.Plugins.Geolocation),
  filesystemAvailable: !!(window.Capacitor && window.Capacitor.Plugins && window.Capacitor.Plugins.Filesystem),
  shareAvailable: !!(window.Capacitor && window.Capacitor.Plugins && window.Capacitor.Plugins.Share),
  userAgent: navigator.userAgent,
  platform: navigator.platform
};

// 延迟重试获取 Capacitor（有些设备上桥接注入较慢）
window._waitForCapacitor = function(timeoutMs) {
  timeoutMs = timeoutMs || 3000;
  var startTime = Date.now();
  return new Promise(function(resolve) {
    function check() {
      if (window.Capacitor && window.Capacitor.Plugins && window.Capacitor.Plugins.CapacitorSQLite) {
        // 刷新引用
        window.CapacitorSQLite = window.Capacitor.Plugins.CapacitorSQLite;
        window.GeolocationPlugin = window.Capacitor.Plugins.Geolocation || null;
        window.FilesystemPlugin = window.Capacitor.Plugins.Filesystem || {};
        window.SharePlugin = window.Capacitor.Plugins.Share || {};
        window._bridgeDiag.capacitorAvailable = true;
        window._bridgeDiag.pluginsAvailable = true;
        window._bridgeDiag.sqliteAvailable = true;
        resolve(true);
        return;
      }
      if (Date.now() - startTime > timeoutMs) {
        resolve(false);
        return;
      }
      setTimeout(check, 200);
    }
    check();
  });
};

console.log('Bridge diag:', JSON.stringify(window._bridgeDiag, null, 2));
