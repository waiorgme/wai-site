/* WAI-ME Home motion - progressive enhancement, ported verbatim from winner-home-v3.html.
   Calm and fully usable underneath: everything is gated on prefers-reduced-motion and
   IntersectionObserver support, and the DOM already holds final copy/figures. */
(function(){
  "use strict";
  var RM = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  var canHover = window.matchMedia("(hover: hover) and (pointer: fine)").matches;

  /* ---- lazy images, fade in when loaded (fall back to gradient on error) ---- */
  var imgs = document.querySelectorAll("img[data-src]");
  function loadImg(img){
    if(img.dataset.loaded) return;
    img.dataset.loaded = "1";
    var real = new Image();
    real.onload = function(){ img.src = img.dataset.src; img.classList.add("loaded"); };
    real.onerror = function(){ /* leave the dawn/aerospace gradient showing */ };
    real.src = img.dataset.src;
  }
  if("IntersectionObserver" in window){
    var io = new IntersectionObserver(function(entries){
      entries.forEach(function(e){ if(e.isIntersecting){ loadImg(e.target); io.unobserve(e.target); } });
    }, { rootMargin: "300px" });
    imgs.forEach(function(i){ io.observe(i); });
  } else {
    imgs.forEach(loadImg);
  }

  /* ---- reveal on scroll ---- */
  var revealEls = document.querySelectorAll(".reveal, .line-mask, .draw");
  if(RM || !("IntersectionObserver" in window)){
    revealEls.forEach(function(el){ el.classList.add("in"); });
  } else {
    var ro = new IntersectionObserver(function(entries){
      entries.forEach(function(e){ if(e.isIntersecting){ e.target.classList.add("in"); ro.unobserve(e.target); } });
    }, { threshold: 0.18, rootMargin: "0px 0px -8% 0px" });
    revealEls.forEach(function(el){ ro.observe(el); });
  }

  /* ---- count-up for the flight-data + stat numbers ---- */
  function fmt(n, comma){ return comma ? n.toLocaleString("en-US") : String(n); }
  function runCount(el){
    var to = parseInt(el.dataset.to, 10);
    var comma = el.dataset.format === "comma";
    if(RM){ el.textContent = fmt(to, comma); return; }
    /* fast enough that a screenshot or a quick scroll never catches a
       half-counted figure (wow-elevation A2) */
    var start = null, dur = 600;
    function step(ts){
      if(start === null) start = ts;
      var p = Math.min((ts - start)/dur, 1);
      var eased = 1 - Math.pow(1 - p, 3);
      el.textContent = fmt(Math.round(to * eased), comma);
      if(p < 1) requestAnimationFrame(step);
    }
    requestAnimationFrame(step);
  }
  var counts = document.querySelectorAll(".count");
  /* the DOM already holds the final figures, so no-JS / no-observer users see them.
     only reset to 0 when we are actually going to animate the count up. */
  if(("IntersectionObserver" in window) && !RM){
    counts.forEach(function(c){ c.textContent = fmt(0, c.dataset.format === "comma"); });
    var co = new IntersectionObserver(function(entries){
      entries.forEach(function(e){ if(e.isIntersecting){ runCount(e.target); co.unobserve(e.target); } });
    }, { threshold: 0.6 });
    counts.forEach(function(c){ co.observe(c); });
  }

  /* ---- header state without a scroll listener (sentinel) ---- */
  var sentinel = document.getElementById("topSentinel");
  if(sentinel && "IntersectionObserver" in window){
    var ho = new IntersectionObserver(function(entries){
      document.body.classList.toggle("scrolled", !entries[0].isIntersecting);
    }, { threshold: 0 });
    ho.observe(sentinel);
  }

  /* ---- mobile menu with focus trap + Escape ---- */
  var burger = document.getElementById("hamburger");
  var menu = document.getElementById("mobileMenu");
  var lastFocus = null;
  function focusables(){ return menu.querySelectorAll("a[href], button"); }
  function openMenu(){
    lastFocus = document.activeElement;
    document.body.classList.add("menu-open");
    document.body.style.overflow = "hidden";
    burger.setAttribute("aria-expanded","true");
    burger.setAttribute("aria-label","Close menu");
    var f = focusables(); if(f.length) f[0].focus();
  }
  function closeMenu(){
    document.body.classList.remove("menu-open");
    document.body.style.overflow = "";
    burger.setAttribute("aria-expanded","false");
    burger.setAttribute("aria-label","Open menu");
    if(lastFocus) lastFocus.focus();
  }
  if(burger && menu){
    burger.addEventListener("click", function(){
      document.body.classList.contains("menu-open") ? closeMenu() : openMenu();
    });
    menu.addEventListener("click", function(e){ if(e.target.matches("a")) closeMenu(); });
    document.addEventListener("keydown", function(e){
      if(!document.body.classList.contains("menu-open")) return;
      if(e.key === "Escape"){ closeMenu(); }
      if(e.key === "Tab"){
        var f = focusables(); if(!f.length) return;
        var first = f[0], last = f[f.length-1];
        if(e.shiftKey && document.activeElement === first){ e.preventDefault(); last.focus(); }
        else if(!e.shiftKey && document.activeElement === last){ e.preventDefault(); first.focus(); }
      }
    });
  }

  /* ---- magnetic CTA (motion values via direct transform + rAF lerp) ---- */
  if(canHover && !RM){
    document.querySelectorAll(".magnetic").forEach(function(el){
      var tx=0, ty=0, cx=0, cy=0, raf=null;
      function loop(){
        cx += (tx - cx) * 0.16; cy += (ty - cy) * 0.16;
        el.style.transform = "translate(" + cx.toFixed(2) + "px," + cy.toFixed(2) + "px)";
        if(Math.abs(tx-cx) > 0.1 || Math.abs(ty-cy) > 0.1){ raf = requestAnimationFrame(loop); }
        else { raf = null; }
      }
      el.addEventListener("pointermove", function(e){
        var r = el.getBoundingClientRect();
        tx = (e.clientX - (r.left + r.width/2)) * 0.3;
        ty = (e.clientY - (r.top + r.height/2)) * 0.3;
        if(!raf) raf = requestAnimationFrame(loop);
      });
      el.addEventListener("pointerleave", function(){
        tx = 0; ty = 0; if(!raf) raf = requestAnimationFrame(loop);
      });
    });
  }

  /* ---- specular card light: cards catch the pointer (elevation slice).
          One delegated, rAF-throttled listener; CSS paints the sheen. ---- */
  if(canHover && !RM){
    var lumeSel = [
      ".fd-cell",".out-card",".pillar",".ev-card",".logo-cell",
      ".who-card",".tier-card",".step-card",".get-card",".receive-card",
      ".impact-card",".mv-card",".board-card",".amb-card",".recent-card",".ev-arch-card"
    ].join(",");
    document.querySelectorAll(lumeSel).forEach(function(c){ c.classList.add("lume"); });
    var lumeRaf = null;
    document.addEventListener("pointermove", function(e){
      var card = e.target && e.target.closest ? e.target.closest(".lume") : null;
      if(!card || lumeRaf) return;
      lumeRaf = requestAnimationFrame(function(){
        lumeRaf = null;
        var r = card.getBoundingClientRect();
        card.style.setProperty("--mx", (((e.clientX - r.left) / r.width) * 100).toFixed(2) + "%");
        card.style.setProperty("--my", (((e.clientY - r.top) / r.height) * 100).toFixed(2) + "%");
      });
    }, { passive:true });
  }

  /* ---- nav pill indicator: glides behind the active page link, follows hover/focus ---- */
  var navLinks = document.querySelector(".nav .links");
  if(navLinks){
    var ind = navLinks.querySelector(".nav-ind");
    var anchors = navLinks.querySelectorAll("a");
    var activeLink = navLinks.querySelector('a[aria-current="page"]');
    var isRTL = getComputedStyle(navLinks).direction === "rtl";
    if(ind){
      var place = function(el, animate){
        if(!el){ ind.style.opacity = "0"; return; }
        if(!animate){
          var prev = ind.style.transition;
          ind.style.transition = "none";
        }
        // offsetLeft is always measured from the LEFT edge; inset-inline-start is the
        // RIGHT edge under RTL, so mirror the offset there.
        var start = isRTL
          ? navLinks.clientWidth - el.offsetLeft - el.offsetWidth
          : el.offsetLeft;
        ind.style.insetInlineStart = start + "px";
        ind.style.inlineSize = el.offsetWidth + "px";
        ind.style.opacity = "1";
        if(!animate){ void ind.offsetWidth; ind.style.transition = prev; }
      };
      place(activeLink, false);
      if(canHover){
        anchors.forEach(function(a){
          a.addEventListener("mouseenter", function(){ place(a, true); });
        });
        navLinks.addEventListener("mouseleave", function(){ place(activeLink, true); });
      }
      anchors.forEach(function(a){
        a.addEventListener("focus", function(){ place(a, true); });
      });
      navLinks.addEventListener("focusout", function(){ place(activeLink, true); });
      var rt;
      window.addEventListener("resize", function(){
        clearTimeout(rt);
        rt = setTimeout(function(){ place(activeLink, false); }, 120);
      });
    }
  }
})();
