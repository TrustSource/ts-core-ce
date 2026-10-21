import { Template } from 'meteor/templating';
import { ReactiveVar } from 'meteor/reactive-var';
import {Tracker} from 'meteor/tracker';
import {Session} from 'meteor/session';

const SLIDE_ITEM = '.fan-carousel__slide'

function wrapIndex(index, total) {
  return ((index % total) + total) % total;
}

Template.fanGallery.onCreated(function () {
  this.currentIndex = new ReactiveVar(0);
});

Template.fanGallery.onRendered(function () {
  const instance = this;
  instance.autorun(() => {
    const current = instance.currentIndex.get();
    Template.currentData().images;
    Tracker.afterFlush(() => {
      const slides = instance.findAll(SLIDE_ITEM);
      const total = slides.length;
      if (!total) return;
      slides.forEach((slide, i) => {
        const img = slide.querySelector('img');
        if (!img) return;
        if (!img.src) img.src = img.dataset.src;
        let offset = wrapIndex(i - current, total);
        if (offset > total / 2) offset -= total;
        if (offset < -total / 2) offset += total;
        const abs = Math.abs(offset);
        const spacing = 190 - (abs * 5);
        const translateX = offset * Math.max(190, spacing);
        const translateZ = -abs * 15;
        const rotateY = offset * -20;
        const scale = Math.max(0.6, 1 - abs * 0.15);
        slide.style.transform = 'translate(-50%, -50%)';
        slide.style.zIndex = 100 - abs;
        img.style.setProperty('--f-translateX', `${translateX}px`);
        img.style.setProperty('--f-translateZ', `${translateZ}px`);
        img.style.setProperty('--f-rotateY', `${rotateY}deg`);
        img.style.setProperty('--f-scale', scale);
      });
    });
  });
});

Template.fanGallery.helpers({
  images() {
    const data = Template.instance().data;
    return (data && data.images && data.images.length) ? data.images : [];
  }
});

Template.fanGallery.events({
  'click .fan-carousel__slide'(event, instance) {
    const slides = instance.findAll('.fan-carousel__slide');
    const total = slides.length;
    const idx = Number(event.currentTarget.dataset.index);
    instance.currentIndex.set(wrapIndex(idx, total));
    Session.set('currentFanGalleryIndex', idx);
  },

  'keydown .fan-carousel'(event, instance) {
    const slides = instance.findAll(SLIDE_ITEM);
    const total = slides.length;
    let current = instance.currentIndex.get();
    if (event.key === 'ArrowRight') {
      event.preventDefault();
      current = wrapIndex(current + 1, total);
    }
    if (event.key === 'ArrowLeft') {
      event.preventDefault();
      current = wrapIndex(current - 1, total);
    }
    instance.currentIndex.set(current);
    Session.set('currentFanGalleryIndex', current);
  }
});
