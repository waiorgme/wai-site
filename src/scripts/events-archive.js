/* WAI-ME Events archive - progressive enhancement (filter + paginate).
   The full set of 32 cards is already server-rendered and visible. This layer adds:
   - category filtering via an aria-pressed button group (keyboard accessible)
   - client-side "Show more" pagination (initial batch from data-page-size)
   With JS off, every card stays visible and the Show-more control stays hidden.
   Reveal motion reuses the shared .reveal/IntersectionObserver from home-motion.js;
   under prefers-reduced-motion the shared CSS neutralises it. */
(function () {
  "use strict";

  var grid = document.querySelector("[data-events-grid]");
  if (!grid) return;

  var filtersWrap = document.querySelector("[data-events-filters]");
  var emptyEl = document.querySelector("[data-events-empty]");
  var moreRow = document.querySelector("[data-events-more-row]");
  var moreBtn = document.querySelector("[data-events-more]");
  var remainingEl = document.querySelector("[data-events-remaining]");

  var cards = Array.prototype.slice.call(grid.querySelectorAll(".ev-arch-card"));
  var filterBtns = filtersWrap
    ? Array.prototype.slice.call(filtersWrap.querySelectorAll(".ev-filter"))
    : [];

  var PAGE_SIZE = parseInt(grid.getAttribute("data-page-size"), 10) || 9;

  var RM = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  var canObserve = "IntersectionObserver" in window;

  var activeFilter = "All";
  var shown = PAGE_SIZE;

  function matches(card) {
    return activeFilter === "All" || card.getAttribute("data-category") === activeFilter;
  }

  /* Mark a card revealed. Reuse the shared reveal motion: clear the .in class so
     newly shown cards animate in, then let the shared observer (or RM fallback)
     re-add it. Simpler and motion-safe: just add .in directly when reduced motion. */
  function reveal(card) {
    if (RM || !canObserve) {
      card.classList.add("in");
    } else {
      // re-trigger the entrance transition for freshly shown cards
      card.classList.remove("in");
      // force reflow so the transition restarts
      void card.offsetWidth;
      requestAnimationFrame(function () {
        card.classList.add("in");
      });
    }
  }

  function render() {
    var visibleInFilter = 0;
    var count = 0;

    cards.forEach(function (card) {
      if (!matches(card)) {
        card.hidden = true;
        return;
      }
      visibleInFilter++;
      if (count < shown) {
        if (card.hidden) {
          card.hidden = false;
          reveal(card);
        } else {
          card.hidden = false;
        }
        count++;
      } else {
        card.hidden = true;
      }
    });

    // empty state
    if (emptyEl) emptyEl.hidden = visibleInFilter !== 0;

    // show-more control
    var remaining = visibleInFilter - count;
    if (moreRow && moreBtn) {
      if (remaining > 0) {
        moreRow.hidden = false;
        if (remainingEl) remainingEl.textContent = "+" + remaining;
      } else {
        moreRow.hidden = true;
      }
    }
  }

  function setFilter(value) {
    activeFilter = value;
    shown = PAGE_SIZE;
    filterBtns.forEach(function (btn) {
      btn.setAttribute(
        "aria-pressed",
        btn.getAttribute("data-filter") === value ? "true" : "false"
      );
    });
    render();
  }

  filterBtns.forEach(function (btn) {
    btn.addEventListener("click", function () {
      setFilter(btn.getAttribute("data-filter"));
    });
  });

  if (moreBtn) {
    moreBtn.addEventListener("click", function () {
      shown += PAGE_SIZE;
      render();
    });
  }

  // Initial enhanced render: collapse to the first batch.
  render();
})();
