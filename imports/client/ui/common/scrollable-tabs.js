import {$} from 'meteor/jquery';

const SCROLL_AMOUNT = 500;
const SCROLL_DURATION = 200;

function updateScrollClasses(wrapper) {
  const tabs = wrapper.find('.nav-tabs')[0];
  if (!tabs) return;
  const scrollLeft = tabs.scrollLeft;
  const maxScroll = tabs.scrollWidth - tabs.clientWidth;
  wrapper.toggleClass('can-scroll-left', scrollLeft > 1);
  wrapper.toggleClass('can-scroll-right', maxScroll - scrollLeft > 1);
}

function scrollActiveTabIntoView(wrapper) {
  const tabs = wrapper.find('.nav-tabs');
  const active = tabs.find('> li.active');
  if (!active.length || !tabs.length) return;
  const tabsEl = tabs[0];
  const activeEl = active[0];
  const left = activeEl.offsetLeft;
  const right = left + activeEl.offsetWidth;
  const visibleLeft = tabsEl.scrollLeft;
  const visibleRight = visibleLeft + tabsEl.clientWidth;
  if (left < visibleLeft) {
    tabs.animate({scrollLeft: left - 20}, SCROLL_DURATION);
  } else if (right > visibleRight) {
    tabs.animate({scrollLeft: right - tabsEl.clientWidth + 20}, SCROLL_DURATION);
  }
}

export function initScrollableTabs(instance) {
  const wrapper = instance.$('.nav-tabs-scrollable');
  if (!wrapper.length) return;

  function onScroll() {
    updateScrollClasses(wrapper);
  }

  function onTabShown() {
    setTimeout(function () {
      scrollActiveTabIntoView(wrapper);
    }, 50);
  }

  function onArrowLeftClick(e) {
    e.preventDefault();
    const tabs = wrapper.find('.nav-tabs');
    tabs.animate({scrollLeft: tabs[0].scrollLeft - SCROLL_AMOUNT}, SCROLL_DURATION);
  }

  function onArrowRightClick(e) {
    e.preventDefault();
    const tabs = wrapper.find('.nav-tabs');
    tabs.animate({scrollLeft: tabs[0].scrollLeft + SCROLL_AMOUNT}, SCROLL_DURATION);
  }

  function onWheel(e) {
    if (e.deltaY !== 0) {
      e.preventDefault();
      tabs[0].scrollLeft += e.deltaY;
    }
  }

  function onResize() {
    updateScrollClasses(wrapper);
  }

  const tabs = wrapper.find('.nav-tabs');
  tabs[0].addEventListener('wheel', onWheel, {passive: false});
  tabs.on('scroll', onScroll);
  wrapper.find('.nav-tabs-arrow-left').on('click', onArrowLeftClick);
  wrapper.find('.nav-tabs-arrow-right').on('click', onArrowRightClick);
  tabs.on('shown.bs.tab', 'a[data-toggle="tab"]', onTabShown);
  $(window).on('resize.scrollableTabs', onResize);

  // Store references for cleanup
  instance._scrollableTabsCleanup = function () {
    tabs[0].removeEventListener('wheel', onWheel);
    tabs.off('scroll', onScroll);
    wrapper.find('.nav-tabs-arrow-left').off('click', onArrowLeftClick);
    wrapper.find('.nav-tabs-arrow-right').off('click', onArrowRightClick);
    tabs.off('shown.bs.tab', 'a[data-toggle="tab"]', onTabShown);
    $(window).off('resize.scrollableTabs', onResize);
  };

  // Initial state
  setTimeout(function () {
    updateScrollClasses(wrapper);
    scrollActiveTabIntoView(wrapper);
  }, 100);
}

export function destroyScrollableTabs(instance) {
  if (instance._scrollableTabsCleanup) {
    instance._scrollableTabsCleanup();
    instance._scrollableTabsCleanup = null;
  }
}
