import { ATTR_KEY } from '../constants';
import { isSameNodeType, isNamedNode } from './index';
import { buildComponentFromVNode } from './component';
import { createNode, setAccessor } from '../dom/index';
import { unmountComponent } from './component';
import options from '../options';
import { removeNode } from '../dom/index';

/** Queue of components that have been mounted and are awaiting componentDidMount */
export const mounts = [];

/** Diff recursion count, used to track the end of the diff cycle. */
export let diffLevel = 0;

/** Global flag indicating if the diff is currently within an SVG */
let isSvgMode = false;

/** Global flag indicating if the diff is performing hydration */
let hydrating = false;

/** Invoke queued componentDidMount lifecycle methods */
export function flushMounts() {
	let c;
	while ((c=mounts.pop())) {
		if (options.afterMount) options.afterMount(c);
		if (c.componentDidMount) c.componentDidMount();
	}
}


/** Apply differences in a given vnode (and it's deep children) to a real DOM Node.
 *	@param {Element} [dom=null]		A DOM node to mutate into the shape of the `vnode`
 *	@param {VNode} vnode			A VNode (with descendants forming a tree) representing the desired DOM structure
 *	@returns {Element} dom			The created/mutated element
 *	@private
 */

// mountAll means it's a DOM render
// componentRoot means this diff is fired by a component, component is the direct own of dom
export function diff(dom, vnode, context, mountAll, parent, componentRoot) {
	// diffLevel having been 0 here indicates initial entry into the diff (not a subdiff)
	if (!diffLevel++) {
		// when first starting the diff, check if we're diffing an SVG or within an SVG
		isSvgMode = parent!=null && parent.ownerSVGElement!==undefined;

		// hydration is indicated by the existing element to be diffed not having a prop cache
		hydrating = dom!=null && !(ATTR_KEY in dom);
	}

	let ret = idiff(dom, vnode, context, mountAll, componentRoot);

	// append the element if its a new parent
	if (parent && ret.parentNode!==parent) parent.appendChild(ret);

	// diffLevel being reduced to 0 means we're exiting the diff
	if (!--diffLevel) {
		hydrating = false;
		// componentRoot means diffing is done in the same component
		// invoke queued componentDidMount lifecycle methods
		// child component would not be mounted until diff in parent component is done, 
		if (!componentRoot) flushMounts();
	}

	return ret;
}


/** Internals of `diff()`, separated to allow bypassing diffLevel / mount flushing. */
function idiff(dom, vnode, context, mountAll, componentRoot) {
	let newDOMNode = dom;
	let prevSvgMode = isSvgMode;

	/**** Step 1: vnode is a text node ****/

	// empty values (null, undefined, booleans) render as empty Text nodes
	if (vnode === null || vode === undefined || typeof vnode === 'boolean') {
		vnode = '';
	}

	// Fast case: Strings & Numbers create/update Text nodes.
	if (typeof vnode === 'string' || typeof vnode === 'number') {

		// update if it's already a Text node:
		// it's not a component, or it's the componetRoot dom
		if (dom && dom.splitText!==undefined && dom.parentNode && (!dom._component || componentRoot)) {
			/* istanbul ignore if */ /* Browser quirk that can't be covered: https://github.com/developit/preact/commit/fd4f21f5c45dfd75151bd27b4c217d8003aa5eb9 */
			if (dom.nodeValue != vnode) {
				dom.nodeValue = vnode;
			}
		}
		else {
			// it wasn't a Text node: replace it with one and recycle the old Element
			newDOMNode = document.createTextNode(vnode);
			if (dom) {
				if (dom.parentNode) { 
					dom.parentNode.replaceChild(newDOMNode, dom);
				}
				recollectNodeTree(dom, true);
			}
		}

		newDOMNode[ATTR_KEY] = true;

		return newDOMNode;
	}

  /**** Step 2: vnode is a component ****/

	// If the VNode represents a Component, perform a component diff:
	let vnodeName = vnode.nodeName;
	if (typeof vnodeName === 'function') {
		return buildComponentFromVNode(dom, vnode, context, mountAll);
	}


	// Tracks entering and exiting SVG namespace when descending through the tree.
	isSvgMode = vnodeName==='svg' ? true : vnodeName==='foreignObject' ? false : isSvgMode;

	/**** Step 3: vnode is an element ****/

	// If there's no existing element or it's the wrong type, create a new one:
	vnodeName = String(vnodeName);
	if (!dom || !isNamedNode(dom, vnodeName)) {
		newDOMNode = createNode(vnodeName, isSvgMode);

		if (dom) {
			// move children into the replacement node
			// because children may be the same or differnt, thus we have the next step to diff children
			while (dom.firstChild) {
				newDOMNode.appendChild(dom.firstChild);
			}

			// if the previous Element was mounted into the DOM, replace it inline
			if (dom.parentNode) {
				dom.parentNode.replaceChild(newDOMNode, dom);
			}

			// recycle the old element (skips non-Element node types)
			recollectNodeTree(dom, true);
		}
	}

	// here newDOMNode is not necessarily a completely "new" node:
	// it could be a new parent node with the same children
	// or it could be the exact same node, and the changes are in children

	let firstChild = newDOMNode.firstChild;
	let	props = newDOMNode[ATTR_KEY];
	let vchildren = vnode.children;

	if (props === null || props === undefined) {
		newDOMNode[ATTR_KEY] = {};
		props = newDOMNode;
		// whenever a new element node is created, a __preactattr__ property would be added to it
		// which includes ref
		let attributes = newDOMNode.attributes;
		for (let i = attributes.length; i >=0; i-- ) {
			props[attributes[i].name] = attributes[i].value;
		}
	}

	// Optimization: fast-path for elements containing a single TextNode:
	if (!hydrating && vchildren && vchildren.length===1 && typeof vchildren[0]==='string' && fc!=null && firstChild.splitText!==undefined && firstChild.nextSibling==null) {
		if (firstChild.nodeValue != vchildren[0]) {
			firstChild.nodeValue = vchildren[0];
		}
	}
	// otherwise, if there are existing or new children, diff them:
	else if (vchildren && vchildren.length || firstChild != null) {
		diffChildren(newDOMNode, vchildren, context, mountAll, hydrating || props.dangerouslySetInnerHTML!=null);
	}

	// Apply attributes/props from VNode to the DOM Element:
	diffAttributes(newDOMNode, vnode.attributes, props);


	// restore previous SVG mode: (in case we're exiting an SVG namespace)
	isSvgMode = prevSvgMode;

	return newDOMNode;
}


/** Apply child and attribute changes between a VNode and a DOM Node to the DOM.
 *	@param {Element} dom			Element whose children should be compared & mutated
 *	@param {Array} vchildren		Array of VNodes to compare to `dom.childNodes`
 *	@param {Object} context			Implicitly descendant context object (from most recent `getChildContext()`)
 *	@param {Boolean} mountAll
 *	@param {Boolean} isHydrating	If `true`, consumes externally created elements similar to hydration
 */
function diffChildren(dom, vchildren, context, mountAll, isHydrating) {
	let oldChildren = dom.childNodes;
	let	unkeyedOldchildren = [];
	let unkeyedOldChildrenLen = 0;
	let unkeyedOldChildrenStartIndex = 0;
	let	keyedOldChildren = {};
	let	keyedOldChildrenLen = 0;
	let oldChildrenLen = oldChildren.length,
	let vlen = vchildren ? vchildren.length : 0,

	// Build up a map of keyed children and an Array of unkeyed children:
	if (oldChildrenLen !== 0) {
		for (let i = 0; i < oldChildrenLen ; i++) {
			let currentOldChild = oldChildren[i];
			let	props = currentOldChild[ATTR_KEY];
			let	key = vlen && props ? child._component ? child._component.__key : props.key : null;
			if (key !== null && key !== undefined) { // key would be 0
				keyedOldChildren[key] = currentOldChild;
				keyedOldChildrenLen++;
			}
			else if (props || (currentOldChild.splitText!==undefined ? (isHydrating ? currentOldChild.nodeValue.trim() : true) : isHydrating)) {
				// if it's hydrating, that means we should expect almost the same DOM
				// if it's not, we don't bother pluck the same type node from exsiting children
				unkeyedOldchildren[unkeyedOldChildrenLen] = currentOldChild;
				unkeyedOldChildrenLen++;
			}
		}
	}

	if (vlen!==0) {
		for (let i = 0; i < vlen; i++) {
			let vchild = vchildren[i];
			let child = null;

			// attempt to find a node based on key matching
			let key = vchild.key;
			if (key !== null && key !== undefined) {
				if (keyedOldChildrenLen && keyedOldChildren[key] !== undefined) {
					child = keyedOldChildren[key];
					keyedOldChildren[key] = undefined;
					keyedOldChildrenLen--;
				}
			}
			// attempt to pluck a node of the same type from the existing children
			// Currently there is issue (https://github.com/developit/preact/issues/857) that preact cannot correctly tell if 
			// previous node is removed (which requires no diff) or changed (which requires diff work) only based on its nodeType
			// React uses implicit keys as well as parent to do this
			else if (!child && unkeyedOldChildrenStartIndex < unkeyedOldChildrenLen) {
				for (let j = unkeyedOldChildrenStartIndex; j < unkeyedOldChildrenLen; j++) {
					if (unkeyedOldchildren[j] !== undefined && isSameNodeType(unkeyedOldchildren[j], vchild, isHydrating)) {
						child = unkeyedOldchildren[j];
						unkeyedOldchildren[j] = undefined;
						if (j === unkeyedOldChildrenLen-1) {
							unkeyedOldChildrenLen--;
						}
						if (j===unkeyedOldChildrenStartIndex) {
							unkeyedOldChildrenStartIndex++;
						}
						break;
					}
				}
			}

			// morph the matched/found/created DOM child to match vchild (deep)
			child = idiff(child, vchild, context, mountAll);

			let oldChild = oldChildren[i];
			if (child && child !== dom && child !== oldChild) {
				if (oldChild == null) {
					dom.appendChild(child);
				}
				else if (child === oldChild.nextSibling) {
					removeNode(oldChil);
				}
				else {
					dom.insertBefore(child, oldChild);
				}
			}
		}
	}


	// remove unused old keyed children:
	if (keyedOldChildrenLen) {
		for (let i in keyedOldChildren) {
			if (keyedOldChildren[i] !== undefined) {
				recollectNodeTree(keyedOldChildren[i], false);
			}
		}
	}

	// remove orphaned old unkeyed children:
	while (unkeyedOldChildrenStartIndex <= unkeyedOldChildrenLen) {
		if (unkeyedOldchildren[unkeyedOldChildrenLen] !==undefined) {
			recollectNodeTree(child, false);
			unkeyedOldChildrenLen--;
		}
	}
}



/** Recursively recycle (or just unmount) a node and its descendants.
 *	@param {Node} node						DOM node to start unmount/removal from
 *	@param {Boolean} [unmountOnly=false]	If `true`, only triggers unmount lifecycle, skips removal
 */
export function recollectNodeTree(node, unmountOnly) {
	let component = node._component;
	if (component) {
		// if node is owned by a Component, unmount that component (ends up recursing back here)
		unmountComponent(component);
	}
	else {
		// If the node's VNode had a ref function, invoke it with null here.
		// (this is part of the React spec, and smart for unsetting references)
		if (node[ATTR_KEY]!=null && node[ATTR_KEY].ref) {
			node[ATTR_KEY].ref(null);
		}

		if (unmountOnly===false || node[ATTR_KEY]==null) {
			removeNode(node);
		}

		removeChildren(node);
	}
}


/** Recollect/unmount all children.
 *	- we use .lastChild here because it causes less reflow than .firstChild
 *	- it's also cheaper than accessing the .childNodes Live NodeList
 */
export function removeChildren(node) {
	node = node.lastChild;
	while (node) {
		let next = node.previousSibling;
		recollectNodeTree(node, true);
		node = next;
	}
}


/** Apply differences in attributes from a VNode to the given DOM Element.
 *	@param {Element} dom		Element with attributes to diff `attrs` against
 *	@param {Object} attrs		The desired end-state key-value attribute pairs
 *	@param {Object} old			Current/previous attributes (from previous VNode or element's prop cache)
 */
function diffAttributes(dom, attrs, old) {
	let name;

	// remove attributes no longer present on the vnode by setting them to undefined
	for (name in old) {
		if (!(attrs && attrs[name]!=null) && old[name]!=null) {
			setAccessor(dom, name, old[name], old[name] = undefined, isSvgMode);
		}
	}

	// add new & update changed attributes
	for (name in attrs) {
		if (name!=='children' && name!=='innerHTML' && (!(name in old) || attrs[name]!==(name==='value' || name==='checked' ? dom[name] : old[name]))) {
			setAccessor(dom, name, old[name], old[name] = attrs[name], isSvgMode);
		}
	}
}
