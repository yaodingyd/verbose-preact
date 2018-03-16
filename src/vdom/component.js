import { SYNC_RENDER, NO_RENDER, FORCE_RENDER, ASYNC_RENDER, ATTR_KEY } from '../constants';
import options from '../options';
import { extend } from '../util';
import { enqueueRender } from '../render-queue';
import { getNodeProps } from './index';
import { diff, mounts, diffLevel, flushMounts, recollectNodeTree, removeChildren } from './diff';
import { createComponent, collectComponent } from './component-recycler';
import { removeNode } from '../dom/index';

/** Set a component's `props` (generally derived from JSX attributes).
 *	@param {Object} props
 *	@param {Object} [opts]
 *	@param {boolean} [opts.renderSync=false]	If `true` and {@link options.syncComponentUpdates} is `true`, triggers synchronous rendering.
 *	@param {boolean} [opts.render=true]			If `false`, no render will be triggered.
 */
export function setComponentProps(component, props, opts, context, mountAll) {
	if (component._disable) return;
	component._disable = true;

	if (props.ref) {
		component.__ref = props.ref;
		delete props.ref;
	}
	if (props.key) { 
		component.__key = props.key;
		delete props.key;
	}

	if (!component.base || mountAll) {
		if (component.componentWillMount) {
			component.componentWillMount();
		}
	}
	else if (component.componentWillReceiveProps) {
		component.componentWillReceiveProps(props, context);
	}

	if (context && context !== component.context) {
		if (!component.prevContext) {
			component.prevContext = component.context;
		}
		component.context = context;
	}

	if (!component.prevProps) {
		component.prevProps = component.props;
	}
	component.props = props;

	component._disable = false;

	if (opts !== NO_RENDER) {
		if (opts === SYNC_RENDER || options.syncComponentUpdates !== false || !component.base) {
			renderComponent(component, SYNC_RENDER, mountAll);
		}
		else {
			enqueueRender(component);
		}
	}

	if (component.__ref) {
		component.__ref(component);
	}
}



/** Render a Component, triggering necessary lifecycle events and taking High-Order Components into account.
 *	@param {Component} component
 *	@param {Object} [opts]
 *	@param {boolean} [opts.build=false]		If `true`, component will build and store a DOM node if not already associated with one.
 *	@private
 */
export function renderComponent(component, opts, mountAll, isRenderedByParent) {
	if (component._disable) return;

	let props = component.props,
		state = component.state,
		context = component.context,
		previousProps = component.prevProps || props,
		previousState = component.prevState || state,
		previousContext = component.prevContext || context,
		isUpdate = component.base,
		nextBase = component.nextBase,
		initialBase = isUpdate || nextBase,
		initialChildComponent = component._component,
		skip = false,
		rendered;

	// if updating
	if (isUpdate) {
		component.props = previousProps;
		component.state = previousState;
		component.context = previousContext;
		if (opts !== FORCE_RENDER
			&& component.shouldComponentUpdate
			&& component.shouldComponentUpdate(props, state, context) === false) {
			skip = true;
		}
		else if (component.componentWillUpdate) {
			component.componentWillUpdate(props, state, context);
		}
		component.props = props;
		component.state = state;
		component.context = context;
	}

	// garbage collect all prev props
	component.prevProps = component.prevState = component.prevContext = component.nextBase = null;
	component._dirty = false;

	if (!skip) {
		// rendered is the new vnode
		rendered = component.render(props, state, context);

		// context to pass to the child, can be updated via (grand-)parent component
		if (component.getChildContext) {
			context = extend(extend({}, context), component.getChildContext());
		}

		let childComponent = rendered && rendered.nodeName;
		let toUnmount, newBase;

		if (typeof childComponent==='function') {
			// set up high order component link
			// high order component is relatively broad here, includes all component whose child is a component

			let newChildProps = getNodeProps(rendered);
			let oldChildComponent = initialChildComponent;

			// same component, just update component props
			if (oldChildComponent && oldChildComponent.constructor === newChildComponent && newChildProps.key == oldChildComponent.__key) {
				setComponentProps(oldChildComponent, newChildProps, SYNC_RENDER, context, false);
				newBase = oldChildComponent.base;
			}
			else {
			// different component, then we need to unmount old component
				toUnmount = oldChildComponent;

				let newChildComponent = createComponent(childComponent, childProps, context);
				component._component = newChildComponent;
				newChildComponent.nextBase = newChildComponent.nextBase || nextBase;
				newChildComponent._parentComponent = component;
				setComponentProps(newChildComponent, newChildProps, NO_RENDER, context, false);
				renderComponent(newChildComponent, SYNC_RENDER, mountAll, true);
				newBase = newChildComponent.base;
			}
		}
		else {
			let componentBase = initialBase;
			// if there is old child component but there is no new child component,
			// we need to destroy high order component link
			toUnmount = initialChildComponent;
			if (toUnmount) {
				componentBase = null;
				component._component = null;
			}

			if (initialBase || opts === SYNC_RENDER) {
				if (componentBase) {
					componentBase._component = null
				};
				newBase = diff(componentBase, rendered, context, mountAll || !isUpdate, initialBase && initialBase.parentNode, true);
			}
		}

		if (initialBase && newBase !== initialBase && newChildComponent) {
			let baseParent = initialBase.parentNode;
			if (baseParent && newBase !== baseParent) {
				baseParent.replaceChild(newBase, initialBase);

				if (!toUnmount) {
					initialBase._component = null;
					recollectNodeTree(initialBase, false);
				}
			}
		}

		if (toUnmount) {
			unmountComponent(toUnmount);
		}

		component.base = base;
		if (base && !isRenderedByParent) {
			let mostInnerChildComponent = component;
			let outerComponent = component;
			//i f a high-order child component updates without the parent, that component and its base 
			// need to have pointers to the outermost higher order parent.
			while (outerComponent._parentComponent) {
				outerComponent = outerComponent._parentComponent
				outerComponent.base = base;
			}
			base._component = mostInnerChildComponent;
			base._componentConstructor = mostInnerChildComponent.constructor;
		}
	}

	// component is mounting
	if (!isUpdate || mountAll) {
		mounts.unshift(component);
	}
	// component is updating
	else if (!skip) {
		// Ensure that pending componentDidMount() hooks of child components
		// are called before the componentDidUpdate() hook in the parent.
		// Note: disabled as it causes duplicate hooks, see https://github.com/developit/preact/issues/750
		// flushMounts();

		if (component.componentDidUpdate) {
			component.componentDidUpdate(previousProps, previousState, previousContext);
		}
		if (options.afterUpdate) options.afterUpdate(component);
	}

	if (component._renderCallbacks!=null) {
		while (component._renderCallbacks.length) component._renderCallbacks.pop().call(component);
	}

	if (!diffLevel && !isRenderedByParent) flushMounts();
}



/** Apply the Component referenced by a VNode to the DOM.
 *	@param {Element} dom	The DOM node to mutate
 *	@param {VNode} vnode	A Component-referencing VNode
 *	@returns {Element} dom	The created/mutated element
 *	@private
 */
export function buildComponentFromVNode(dom, vnode, context, mountAll) {
	let DOMCachedComponent = dom && dom._component;
	let originalComponent = DOMCachedComponent;
	let	oldDom = dom;
	let isDirectOwner = DOMCachedComponent && dom._componentConstructor === vnode.nodeName,
	let	isOwner = isDirectOwner;
	let	props = getNodeProps(vnode);
	while (DOMCachedComponent && !isOwner && DOMCachedComponent._parentComponent) {
		DOMCachedComponent = DOMCachedComponent._parentComponent;
		isOwner = DOMCachedComponent.constructor === vnode.nodeName;
	}

	// isDirectOwner checks if it's the same component
	// isOwner means it's nested component, like <A><B/></A>, and actual DOM is only in B

	if (DOMCachedComponent && isOwner && (!mountAll || DOMCachedComponent._component)) {
		setComponentProps(DOMCachedComponent, props, ASYNC_RENDER, context, mountAll);
		dom = DOMCachedComponent.base;
	}
	else {
		if (originalComponent && !isDirectOwner) {
			unmountComponent(originalComponent);
			dom = null;
			oldDom = null;
		}

		let newComponent = createComponent(vnode.nodeName, props, context);
		if (dom && !newComponent.nextBase) {
			newComponent.nextBase = dom;
			// passing dom/oldDom as nextBase will recycle it if unused, so bypass recycling on L237:
			oldDom = null;
		}
		setComponentProps(newComponent, props, SYNC_RENDER, context, mountAll);
		let newDom = newComponent.base;

		if (oldDom && newDom !== oldDom) {
			oldDom._component = null;
			recollectNodeTree(oldDom, false);
		}
	}

	return dom;
}



/** Remove a component from the DOM and recycle it.
 *	@param {Component} component	The Component instance to unmount
 *	@private
 */
export function unmountComponent(component) {
	if (options.beforeUnmount) options.beforeUnmount(component);

	let base = component.base;

	component._disable = true;

	if (component.componentWillUnmount) component.componentWillUnmount();

	component.base = null;

	// recursively tear down & recollect high-order component children:
	let inner = component._component;
	if (inner) {
		unmountComponent(inner);
	}
	else if (base) {
		if (base[ATTR_KEY] && base[ATTR_KEY].ref) base[ATTR_KEY].ref(null);

		component.nextBase = base;

		removeNode(base);
		collectComponent(component);

		removeChildren(base);
	}

	if (component.__ref) component.__ref(null);
}
