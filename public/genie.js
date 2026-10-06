/* ============================================================================
   genie.js — l'effet Genie de macOS, en WebGL, sans dependance.
   ----------------------------------------------------------------------------
   La fenetre est rasterisee une fois en texture, puis plaquee sur un maillage
   dont le vertex shader deplace chaque sommet selon une progression 0..1 :
   les bords lateraux s'evasent vers l'icone, et chaque rangee avance avec un
   decalage qui depend de sa distance a l'icone, si bien que le bord proche
   atteint l'icone avant le bord oppose.

   Trois proprietes sont garanties par construction (voir le shader) :
     - a p = 0 le maillage recouvre exactement le rectangle de la fenetre ;
     - a p = 1 il recouvre exactement celui de l'icone ;
     - l'evasement ne commence qu'au-dela du bord de la fenetre,
   donc ni la premiere ni la derniere image ne « saute ».

   API :
     var genie = createGenie({ duration: 600 });
     genie.prime(el, css);            // prepare la texture au repos
     genie.open(el, iconRect);        // renvoie une promesse
     genie.close(el, iconRect);
     genie.invalidate();              // apres un resize : la texture est refaite
     genie.destroy();                 // libere canvas, texture et contexte

   Replis : si WebGL manque, si la capture echoue, ou si l'utilisateur demande
   moins d'animation, open/close resolvent immediatement et l'appelant retombe
   sur sa transition CSS.
   ========================================================================== */

(function (global) {
  "use strict";

  var VERT = [
    "attribute vec2 aUV;",
    "uniform vec2 uRes;", // viewport en pixels CSS
    "uniform vec2 uAxis;", // direction d'aspiration, unitaire et alignee sur un axe
    "uniform vec4 uWin;", // x, y, largeur, hauteur de la fenetre a l'ecran
    "uniform vec4 uWinR;", // fenetre projetee : Lmin, Lmax, Cmin, Cmax
    "uniform vec4 uIconR;", // icone projetee : Lmin, Lmax, Cmin, Cmax
    "uniform float uP;", // 0 = fenetre deployee, 1 = aspiree dans l'icone
    "uniform float uStagger;",
    "varying vec2 vUV;",
    "",
    "float easeInOut(float t){",
    "  return t < 0.5 ? 2.0 * t * t : 1.0 - pow(-2.0 * t + 2.0, 2.0) * 0.5;",
    "}",
    "float smooth01(float t){",
    "  t = clamp(t, 0.0, 1.0);",
    "  return t * t * (3.0 - 2.0 * t);",
    "}",
    "",
    "void main(){",
    "  vUV = aUV;",
    "  vec2 perp = vec2(-uAxis.y, uAxis.x);",
    // Position au repos, puis passage dans le repere (profondeur, lateral).
    "  vec2 P0 = uWin.xy + aUV * uWin.zw;",
    "  float L0 = dot(P0, uAxis);",
    "  float C0 = dot(P0, perp);",
    "",
    "  float Lmin = uWinR.x, Lmax = uWinR.y, Cmin = uWinR.z, Cmax = uWinR.w;",
    "  float n  = clamp((L0 - Lmin) / max(Lmax - Lmin, 1e-4), 0.0, 1.0);",
    "  float cu = (C0 - Cmin) / max(Cmax - Cmin, 1e-4);",
    "",
    // n = 1 du cote de l'icone : cette rangee-la part en premier.
    "  float rowP = clamp(uP * (1.0 + uStagger) - (1.0 - n) * uStagger, 0.0, 1.0);",
    "",
    "  float Ltarget = uIconR.x + n * (uIconR.y - uIconR.x);",
    "  float L = mix(L0, Ltarget, easeInOut(rowP));",
    "",
    // L'entonnoir ne se resserre qu'une fois passe le bord de la fenetre.
    "  float s  = smooth01((L - Lmax) / max(uIconR.x - Lmax, 1e-4));",
    "  float CL = mix(Cmin, uIconR.z, s);",
    "  float CR = mix(Cmax, uIconR.w, s);",
    "  float C  = mix(CL, CR, cu);",
    "",
    "  vec2 P = uAxis * L + perp * C;",
    "  gl_Position = vec4(P.x / uRes.x * 2.0 - 1.0, 1.0 - P.y / uRes.y * 2.0, 0.0, 1.0);",
    "}"
  ].join("\n");

  var FRAG = [
    "precision mediump float;",
    "uniform sampler2D uTex;",
    "varying vec2 vUV;",
    "void main(){ gl_FragColor = texture2D(uTex, vUV); }"
  ].join("\n");

  function prefersReducedMotion() {
    return (
      global.matchMedia &&
      global.matchMedia("(prefers-reduced-motion: reduce)").matches
    );
  }

  // Les quatre coins d'un rectangle projetes sur (axe, perpendiculaire).
  function project(rect, axis) {
    var px = -axis[1],
      py = axis[0];
    var xs = [rect.x, rect.x + rect.w];
    var ys = [rect.y, rect.y + rect.h];
    var Lmin = Infinity,
      Lmax = -Infinity,
      Cmin = Infinity,
      Cmax = -Infinity;
    for (var i = 0; i < 2; i++) {
      for (var j = 0; j < 2; j++) {
        var L = xs[i] * axis[0] + ys[j] * axis[1];
        var C = xs[i] * px + ys[j] * py;
        if (L < Lmin) Lmin = L;
        if (L > Lmax) Lmax = L;
        if (C < Cmin) Cmin = C;
        if (C > Cmax) Cmax = C;
      }
    }
    return [Lmin, Lmax, Cmin, Cmax];
  }

  // Le bord d'aspiration est celui qui laisse le plus de place entre la fenetre
  // et le centre de l'icone. Si l'icone est dans la fenetre, aucun bord ne
  // convient et on le signale a l'appelant.
  function pickAxis(win, icon) {
    var cx = icon.x + icon.w / 2;
    var cy = icon.y + icon.h / 2;
    var best = null;
    var cands = [
      [[0, 1], cy - (win.y + win.h)],
      [[0, -1], win.y - cy],
      [[1, 0], cx - (win.x + win.w)],
      [[-1, 0], win.x - cx]
    ];
    for (var i = 0; i < cands.length; i++) {
      if (!best || cands[i][1] > best[1]) best = cands[i];
    }
    return best[1] > 1 ? best[0] : null;
  }

  function createGenie(options) {
    var opt = options || {};
    var duration = opt.duration || 600;
    var cols = opt.cols || 16;
    var rows = opt.rows || 96;
    var stagger = opt.stagger == null ? 0.6 : opt.stagger;
    var pad = opt.pad == null ? 80 : opt.pad; // marge capturee pour l'ombre portee
    var maxTexture = opt.maxTexture || 2048;

    var canvas = null,
      gl = null,
      prog = null,
      uni = null,
      indexCount = 0,
      buffers = null,
      texture = null,
      texSource = null, // { el, css } de la derniere capture
      raf = 0,
      running = null, // resolve de l'animation en cours
      dead = false;

    /* ---------------------------------------------------- capture texture -- */

    // Le SVG porte la taille en pixels voulue et un viewBox aux unites CSS :
    // le navigateur rasterise donc le contenu a la resolution demandee.
    function captureImage(el, cssText, pxScale) {
      var w = el.offsetWidth + pad * 2;
      var h = el.offsetHeight + pad * 2;
      if (!w || !h) return Promise.reject(new Error("genie : fenetre sans taille"));

      var s = Math.min(pxScale, maxTexture / w, maxTexture / h);
      // Dans du XML, seuls & et < doivent etre echappes ; > est licite.
      var style = String(cssText).replace(/&/g, "&amp;").replace(/</g, "&lt;");
      var svg =
        '<svg xmlns="http://www.w3.org/2000/svg" width="' +
        Math.round(w * s) +
        '" height="' +
        Math.round(h * s) +
        '" viewBox="0 0 ' +
        w +
        " " +
        h +
        '">' +
        '<foreignObject x="0" y="0" width="' +
        w +
        '" height="' +
        h +
        '">' +
        '<div xmlns="http://www.w3.org/1999/xhtml" style="padding:' +
        pad +
        'px">' +
        "<style>" +
        style +
        "</style>" +
        el.outerHTML +
        "</div>" +
        "</foreignObject></svg>";

      return new Promise(function (resolve, reject) {
        var img = new Image();
        img.onload = function () {
          resolve(img);
        };
        img.onerror = function () {
          reject(new Error("genie : le SVG de capture n'a pas pu etre decode"));
        };
        img.src =
          "data:image/svg+xml;charset=utf-8," + encodeURIComponent(svg);
      });
    }

    /* ------------------------------------------------------------- WebGL -- */

    function compile(type, src) {
      var sh = gl.createShader(type);
      gl.shaderSource(sh, src);
      gl.compileShader(sh);
      if (!gl.getShaderParameter(sh, gl.COMPILE_STATUS)) {
        var log = gl.getShaderInfoLog(sh);
        gl.deleteShader(sh);
        throw new Error("genie : shader refuse — " + log);
      }
      return sh;
    }

    function initGL() {
      if (gl) return true;
      canvas = document.createElement("canvas");
      canvas.className = "genie-canvas";
      canvas.setAttribute("aria-hidden", "true");
      var attrs = { alpha: true, premultipliedAlpha: true, antialias: true };
      gl = canvas.getContext("webgl", attrs) ||
        canvas.getContext("experimental-webgl", attrs);
      if (!gl) {
        canvas = null;
        return false;
      }

      var vs = compile(gl.VERTEX_SHADER, VERT);
      var fs = compile(gl.FRAGMENT_SHADER, FRAG);
      prog = gl.createProgram();
      gl.attachShader(prog, vs);
      gl.attachShader(prog, fs);
      gl.linkProgram(prog);
      gl.deleteShader(vs);
      gl.deleteShader(fs);
      if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) {
        throw new Error("genie : edition de liens — " + gl.getProgramInfoLog(prog));
      }
      gl.useProgram(prog);

      uni = {};
      ["uRes", "uAxis", "uWin", "uWinR", "uIconR", "uP", "uStagger", "uTex"].forEach(
        function (n) {
          uni[n] = gl.getUniformLocation(prog, n);
        }
      );

      // Grille de (cols+1) x (rows+1) sommets, en coordonnees 0..1.
      var verts = new Float32Array((cols + 1) * (rows + 1) * 2);
      var k = 0;
      for (var j = 0; j <= rows; j++) {
        for (var i = 0; i <= cols; i++) {
          verts[k++] = i / cols;
          verts[k++] = j / rows;
        }
      }
      var idx = new Uint16Array(cols * rows * 6);
      k = 0;
      for (j = 0; j < rows; j++) {
        for (i = 0; i < cols; i++) {
          var a = j * (cols + 1) + i;
          var b = a + 1;
          var c = a + cols + 1;
          var d = c + 1;
          idx[k++] = a; idx[k++] = c; idx[k++] = b;
          idx[k++] = b; idx[k++] = c; idx[k++] = d;
        }
      }
      indexCount = idx.length;

      buffers = { vert: gl.createBuffer(), index: gl.createBuffer() };
      gl.bindBuffer(gl.ARRAY_BUFFER, buffers.vert);
      gl.bufferData(gl.ARRAY_BUFFER, verts, gl.STATIC_DRAW);
      var loc = gl.getAttribLocation(prog, "aUV");
      gl.enableVertexAttribArray(loc);
      gl.vertexAttribPointer(loc, 2, gl.FLOAT, false, 0, 0);
      gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, buffers.index);
      gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, idx, gl.STATIC_DRAW);

      gl.enable(gl.BLEND);
      gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
      gl.uniform1f(uni.uStagger, stagger);
      gl.uniform1i(uni.uTex, 0);

      document.body.appendChild(canvas);
      return true;
    }

    function uploadTexture(img) {
      if (!texture) {
        texture = gl.createTexture();
        gl.bindTexture(gl.TEXTURE_2D, texture);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
      }
      gl.bindTexture(gl.TEXTURE_2D, texture);
      gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, true);
      gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, true);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, img);
    }

    /* ---------------------------------------------------------- rendu ---- */

    function sizeCanvas() {
      var dpr = Math.min(global.devicePixelRatio || 1, 2);
      var w = Math.round(global.innerWidth * dpr);
      var h = Math.round(global.innerHeight * dpr);
      if (canvas.width !== w || canvas.height !== h) {
        canvas.width = w;
        canvas.height = h;
        canvas.style.width = global.innerWidth + "px";
        canvas.style.height = global.innerHeight + "px";
      }
      gl.viewport(0, 0, w, h);
      gl.uniform2f(uni.uRes, global.innerWidth, global.innerHeight);
    }

    function draw(p) {
      gl.clearColor(0, 0, 0, 0);
      gl.clear(gl.COLOR_BUFFER_BIT);
      gl.uniform1f(uni.uP, p);
      gl.drawElements(gl.TRIANGLES, indexCount, gl.UNSIGNED_SHORT, 0);
    }

    /* ----------------------------------------------------------- public -- */

    // Rend la texture disponible avant le premier clic, pour que l'ouverture
    // n'ait rien a calculer. A appeler au repos, et apres chaque invalidate().
    function prime(el, cssText) {
      if (dead || !initGL()) return Promise.resolve(false);
      var r = el.getBoundingClientRect();
      var k = el.offsetWidth ? r.width / el.offsetWidth : 1;
      var dpr = Math.min(global.devicePixelRatio || 1, 2);
      return captureImage(el, cssText, k * dpr).then(
        function (img) {
          uploadTexture(img);
          texSource = { el: el, css: cssText };
          return true;
        },
        function () {
          texSource = null;
          return false;
        }
      );
    }

    function ready(el, cssText) {
      if (texSource && texSource.el === el && texSource.css === cssText) {
        return Promise.resolve(true);
      }
      return prime(el, cssText);
    }

    // Mesure la scene, choisit le bord d'aspiration et pousse les uniformes.
    // Renvoie false si aucun entonnoir n'est possible : l'appelant retombe
    // alors sur sa transition CSS.
    function prepare(el, iconRect, cssText) {
      return ready(el, cssText).then(function (ok) {
        if (!ok) return false;

        var r = el.getBoundingClientRect();
        var k = el.offsetWidth ? r.width / el.offsetWidth : 1;
        var ps = pad * k;
        var win = {
          x: r.left - ps,
          y: r.top - ps,
          w: r.width + ps * 2,
          h: r.height + ps * 2
        };
        var icon = {
          x: iconRect.left != null ? iconRect.left : iconRect.x,
          y: iconRect.top != null ? iconRect.top : iconRect.y,
          w: iconRect.width != null ? iconRect.width : iconRect.w,
          h: iconRect.height != null ? iconRect.height : iconRect.h
        };

        var axis = pickAxis(win, icon);
        if (!axis) return false; // icone sous la fenetre : pas de bord d'aspiration

        var winR = project(win, axis);
        var iconR = project(icon, axis);
        if (iconR[0] - winR[1] <= 1) return false; // entonnoir degenere

        sizeCanvas();
        gl.uniform2f(uni.uAxis, axis[0], axis[1]);
        gl.uniform4f(uni.uWin, win.x, win.y, win.w, win.h);
        gl.uniform4f(uni.uWinR, winR[0], winR[1], winR[2], winR[3]);
        gl.uniform4f(uni.uIconR, iconR[0], iconR[1], iconR[2], iconR[3]);
        gl.activeTexture(gl.TEXTURE0);
        gl.bindTexture(gl.TEXTURE_2D, texture);
        return true;
      });
    }

    function animate(el, iconRect, cssText, from, to) {
      if (dead || prefersReducedMotion() || !global.requestAnimationFrame) {
        return Promise.resolve(false);
      }
      return prepare(el, iconRect, cssText).then(function (ok) {
        if (!ok) return false;

        stop();
        canvas.style.opacity = "1";
        draw(from);

        return new Promise(function (resolve) {
          var t0 = 0;
          running = function () {
            canvas.style.opacity = "0";
            running = null;
            resolve(true);
          };
          function frame(now) {
            if (!t0) t0 = now;
            var t = Math.min((now - t0) / duration, 1);
            draw(from + (to - from) * t);
            if (t < 1) {
              raf = global.requestAnimationFrame(frame);
            } else {
              raf = 0;
              if (running) running();
            }
          }
          raf = global.requestAnimationFrame(frame);
        });
      });
    }

    // Affiche une seule image a la progression voulue. Sert a verifier au
    // ralenti que rien ne saute ni ne se deforme aux deux extremites.
    function seek(el, iconRect, cssText, p) {
      if (dead) return Promise.resolve(false);
      if (!initGL()) return Promise.resolve(false);
      return prepare(el, iconRect, cssText).then(function (ok) {
        if (!ok) return false;
        stop();
        canvas.style.opacity = "1";
        draw(p);
        return true;
      });
    }

    function stop() {
      if (raf) {
        global.cancelAnimationFrame(raf);
        raf = 0;
      }
      if (running) running();
    }

    return {
      prime: prime,
      // L'icone se deplie : on part de l'etat aspire pour arriver a la fenetre.
      open: function (el, iconRect, cssText) {
        return animate(el, iconRect, cssText, 1, 0);
      },
      close: function (el, iconRect, cssText) {
        return animate(el, iconRect, cssText, 0, 1);
      },
      seek: seek,
      hide: function () {
        stop();
        if (canvas) canvas.style.opacity = "0";
      },
      // Termine net l'animation en cours (resize, navigation…).
      settle: stop,
      invalidate: function () {
        texSource = null;
      },
      destroy: function () {
        dead = true;
        stop();
        if (gl) {
          if (texture) gl.deleteTexture(texture);
          if (buffers) {
            gl.deleteBuffer(buffers.vert);
            gl.deleteBuffer(buffers.index);
          }
          if (prog) gl.deleteProgram(prog);
          var lose = gl.getExtension("WEBGL_lose_context");
          if (lose) lose.loseContext();
        }
        if (canvas && canvas.parentNode) canvas.parentNode.removeChild(canvas);
        canvas = gl = prog = uni = buffers = texture = texSource = null;
      }
    };
  }

  global.createGenie = createGenie;
})(window);
