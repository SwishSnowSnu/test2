window.MathJax = {
  tex: {
    inlineMath:  [["\\(","\\)"]],
    displayMath: [["\\[","\\]"]],
    tags: "ams",
    macros: { vb: ["\\mathbf{#1}", 1] }
  },
  options: {
    skipHtmlTags: ["script","noscript","style","textarea","pre"],
    renderActions: { addMenu: [] }
  },
  startup: { typeset: true }
};
