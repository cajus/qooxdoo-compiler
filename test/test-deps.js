var test = require('tape');
var fs = require("fs");
var async = require("async");
const {promisify, promisifyThis} = require("../lib/qx/tool/compiler/util");
const readFile = promisify(fs.readFile);
require("../lib");

async function createMaker() {

  var STARTTIME = new Date();

  var QOOXDOO_PATH = "../qooxdoo";

  // Makers use an Analyser to figure out what the Target should write
  var maker = new qx.tool.compiler.makers.AppMaker().set({
    // Targets know how to output an application
    target: new qx.tool.compiler.targets.SourceTarget("source-output").set({ writeCompileInfo: true }),
    locales: [ "en"  ],
    writeAllTranslations: true,
    environment: {
      envVar1: "one",
      envVar2: "two"
    }
  });
  maker.addApplication(new qx.tool.compiler.app.Application("testapp.Application").set({
    theme: "qx.theme.Indigo",
    name: "appone",
    environment: {
      envVar2: "222",
      envVar3: "333"
    }
  }));

  return new Promise((resolve, reject) => {
    maker.addLibrary("testapp", function(err) {
      if (err)
        return reject(err);
      maker.addLibrary(QOOXDOO_PATH + "/framework", function(err) {
        if (err)
          reject(err);
        else
          resolve(maker);
      });
    });
  });
}

test('Checks dependencies and environment settings', (assert) => {

  function readJson(filename) {
    return readFile(filename, { encoding: "utf8" })
      .then((str) => JSON.parse(str));
  }
  function readCompileInfo() {
    return readJson("source-output/appone/compile-info.json");
  }
  function readDbJson() {
    return readJson("db.json");
  }
  function hasClassDependency(compileInfo, classname) {
    return compileInfo.Parts.some((part) => {
      return part.classes.indexOf(classname) > -1;
    });
  }
  function hasPackageDependency(compileInfo, packageName) {
    return compileInfo.Parts.some((part) => {
      return part.classes.some((classname) => {
        return classname.indexOf(packageName) == 0;
      });
    });
  }

  var maker;
  var app;
  var compileInfo;
  var db;
  var meta;
  var expected;
  deleteRecursive("source-output")
    .then(() => createMaker())
    .then((_maker) => {
      maker = _maker;
      app = maker.getApplications()[0];
      return promisifyThis(maker.make, maker);
    })
    .then(() => readCompileInfo().then((tmp) => compileInfo = tmp))
    .then(() => {
      // qx.util.format.DateFormat is included manually later on, so this needs to be not included automatically now
      assert.ok(!hasClassDependency(compileInfo, "qx.util.format.DateFormat"), "qx.util.format.DateFormat is automatically included");
    })
    
    /*
     * Test manual include and exclude
     */
    .then(() => {
      app.setExclude([ "qx.ui.layout.*" ]);
      app.setInclude([ "qx.util.format.DateFormat" ]);
      return promisifyThis(maker.make, maker);
    })
    .then(() => readCompileInfo().then((tmp) => compileInfo = tmp))
    .then(() => {
      assert.ok(!hasPackageDependency(compileInfo, "qx.ui.layout"), "qx.ui.layout.* was not excluded");
      assert.ok(hasClassDependency(compileInfo, "qx.util.format.DateFormat"), "qx.util.format.DateFormat is not included");
    })
    // Undo the exclude/include
    .then(() => {
      app.setExclude([ ]);
      app.setInclude([ ]);
      return promisifyThis(maker.make, maker);
    })
    .then(() => readCompileInfo().then((tmp) => compileInfo = tmp))
    .then(() => readDbJson().then((tmp) => db = tmp))
    .then(() => readJson("source-output/transpiled/testapp/Application.json").then((tmp) => meta = tmp))
    
    /*
     * Test class references in the property definition, eg annotation
     */
    .then(() => {
      var ci = db.classInfo["testapp.Application"];
      assert.ok(!!ci.dependsOn["testapp.anno.MyAnno"], "missing dependency on testapp.anno.MyAnno");
      assert.ok(!!ci.dependsOn["testapp.anno.MyAnno"].load, "dependency on testapp.anno.MyAnno is not a load dependency");
    })
    
    /*
     * Test meta generation
     */
    .then(() => {
      assert.equal(meta.className, "testapp.Application");
      assert.equal(meta.packageName, "testapp");
      assert.equal(meta.name, "Application");
      assert.equal(meta.superClass, "qx.application.Standalone");
    })
    
    .then(() => assert.end())
    .catch((err) => assert.end(err));
});

async function deleteRecursive(name) {
  return new Promise((resolve, reject) => {
    fs.exists(name, function(exists) {
      if (!exists)
        return resolve();
      deleteRecursiveImpl(name, (err) => {
        if (err)
          reject(err);
        else
          resolve(err);
      });
    });

    function deleteRecursiveImpl(name, cb) {
      fs.stat(name, function(err, stat) {
        if (err)
          return cb && cb(err);

        if (stat.isDirectory()) {
          fs.readdir(name, function(err, files) {
            if (err)
              return cb && cb(err);
            async.each(files,
                function(file, cb) {
                  deleteRecursiveImpl(name + "/" + file, cb);
                },
                function(err) {
                  if (err)
                    return cb && cb(err);
                  fs.rmdir(name, cb);
                });
          });
        } else {
          fs.unlink(name, cb);
        }
      });
    }
  });
}