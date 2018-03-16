# Verbose Preact

Preact is great in both using and reading it. To achieve minimum file size, there are a lot of coding techniques used in Preact's source code, including concise variable names, assignments in conditional logic and so on. This project makes the most verbose version of Preact's source code to make everything crystal clear.

Most changes are in `vdom/component.js` and `vdom/diff.js`.

## Understanding Preact DOM attributes 

Preact uses actual DOM and virtual dom (vdom) to do diffing. To make diffing efficient, Preact caches a lot of information in DOM node. Here is a list of them:
1. For components, both class components and functional components, the rendered DOM node has one attribute `_component`, which store its `__ref`, `__key`, `state` and so on.
2. `_component` could have another `_component` attribute,(I think `_childComponent` would make more sense) which is the child component; `_parentCompoent`, which is the parent component. This only happens for nested components that have nothing other than its child component, like
```jsx
<A>
  <B>
    <C />
  </B>
</A>
```
3. Preact uses `base` as vnode's rendered DOM node. It works the same for `_component` too: it has `base`, which is the DOM node when it's mounted, and `nextBase`, which it the DOM node when it's unmounted. So next time it's mounted back, Preact uses `nextBase` to do diffing.
4. For non-component rendered DOM node, it has `__preactattr__` attribute . For text node, it's a boolean value(`true`), for element node, it's the vnode's attributes, including `ref`.

## Understanding Preact's diff process

There are two great articles [here](https://medium.com/@asolove/preact-internals-2-the-component-model-36a05e32957b) and [here](https://medium.com/@rajaraodv/the-inner-workings-of-virtual-dom-666ee7ad47cf).

Here I also put a great chart by the first article:
![diff process](https://cdn-images-1.medium.com/max/2000/1*H4ysOfvyT5BMKABhbyslwA.png)



### idiff process

Step 1: diff node itself

if vnode if text node
- if dom is a text node already, update value
- if dom is not a text node, replace it with new created text node
if vode is a component
- do component diff
3. if vnode is element node
- if not the same type, create new node and append old node's child into new node 


Step 2: diff node's children node

Step 3: diff node attribute
- call ref 





