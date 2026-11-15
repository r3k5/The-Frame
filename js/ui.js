// Creates DOM controls shared by the launcher views.
(function (root) {
  'use strict';

  function element(tag, className, text) {
    var node = document.createElement(tag);
    if (className) node.className = className;
    if (text !== undefined) node.textContent = text;
    return node;
  }

  // Default to a regular button. Forms explicitly opt into submit behavior.
  function button(text, className, onClick) {
    var node = element('button', className, text);
    node.type = 'button';
    node.addEventListener('click', onClick);
    return node;
  }

  root.FrameUI = { element: element, button: button };
}(window));
