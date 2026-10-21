import Chart from 'chart.js';
/**
 * This simply a copy of the chart.js "Chart.Tooltip.draw" function.
 * It may be called by a custom tooltip function to mimic the original behaviour.
 * This is unfortunately necessary, due to the fact, that the original function clears the canvas and therefore additional
 * canvas drawings (like center text) are lost.
 *
 * @param ctx  2dContext of the canvas where the chart is drawn
 * @param tooltip the tootip argument of the customTooltips() function
 * @param callback callback, to redraw the canvas after toolbar was cleared
 *
 */
Chart.helpers._drawTooltip = function (ctx, tooltip, callback) {
  if (tooltip) {
    const tooltipWidth = ctx.measureText(tooltip.text).width + 2 * tooltip.xPadding,
      tooltipRectHeight = tooltip.fontSize + 2 * tooltip.yPadding,
      tooltipHeight = tooltipRectHeight + tooltip.caretHeight + tooltip.caretPadding;
    let tooltipX = tooltip.x - tooltipWidth / 2;
    let tooltipY = tooltip.y - tooltipHeight;

    switch (tooltip.yAlign) {
    case 'above':
      // Draw a caret above the x/y
      ctx.beginPath();
      ctx.moveTo(tooltip.x, tooltip.y - tooltip.caretPadding);
      ctx.lineTo(tooltip.x + tooltip.caretHeight, tooltip.y - (tooltip.caretPadding + tooltip.caretHeight));
      ctx.lineTo(tooltip.x - tooltip.caretHeight, tooltip.y - (tooltip.caretPadding + tooltip.caretHeight));
      ctx.closePath();
      ctx.fill();
      break;
    case 'below':
      tooltipY = tooltip.y + tooltip.caretPadding + tooltip.caretHeight;
      // Draw a caret below the x/y
      ctx.beginPath();
      ctx.moveTo(tooltip.x, tooltip.y + tooltip.caretPadding);
      ctx.lineTo(tooltip.x + tooltip.caretHeight, tooltip.y + tooltip.caretPadding + tooltip.caretHeight);
      ctx.lineTo(tooltip.x - tooltip.caretHeight, tooltip.y + tooltip.caretPadding + tooltip.caretHeight);
      ctx.closePath();
      ctx.fill();
      break;
    }

    switch (tooltip.xAlign) {
    case 'left':
      tooltipX = tooltip.x - tooltipWidth + (tooltip.cornerRadius + tooltip.caretHeight);
      break;
    case 'right':
      tooltipX = tooltip.x - (tooltip.cornerRadius + tooltip.caretHeight);
      break;
    }

    Chart.helpers.drawRoundedRectangle(ctx, tooltipX, tooltipY, tooltipWidth, tooltipRectHeight, tooltip.cornerRadius);

    ctx.fill();

    ctx.fillStyle = tooltip.textColor;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(tooltip.text, tooltipX + tooltipWidth / 2, tooltipY + tooltipRectHeight / 2);
  } else {
    callback();
  }
};
