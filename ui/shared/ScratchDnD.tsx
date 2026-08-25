'use client'

import React, { Component } from 'react'
import { createPortal } from 'react-dom'
import {
  closestCenter,
  DndContext,
  DragEndEvent,
  DragOverlay,
  DragStartEvent,
  PointerSensor,
  useDraggable,
  useDroppable,
} from '@dnd-kit/core'
import {
  arrayMove,
  horizontalListSortingStrategy,
  SortableContext,
  useSortable,
} from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'
import { uuid } from 'utils'
import clsx from 'clsx'
import { OpCodeTypes } from '../OpCodeParser/OpFunctions'
import { hexToScript } from 'lib/hexToScript'

type ItemType = {
  id: string
  index: number
  content: string
  category: string
}

interface Group {
  heading: string
  items: ItemType[]
}

type StateType = {
  [key: string]: ItemType[]
}

const internalOpcodes: string[] = ['INITIAL_STACK']
const experimentalOpCodes: string[] = ['OP_CAT']

const LIST_ID_PREFIX = 'list-'
const TOOLBOX_ID_PREFIX = 'toolbox-'

type DragItemData = {
  type: 'toolbox' | 'script'
  item: ItemType
  listId?: string
}

let ITEMS: ItemType[] = Object.keys(OpCodeTypes)
  .filter((key) => !internalOpcodes.includes(key))
  .map((item, index) => ({
    id: uuid(),
    index: index,
    content: item,
    category: OpCodeTypes[item],
  }))

const getListDroppableId = (listId: string) => `${LIST_ID_PREFIX}${listId}`

const ScriptDropZone = ({
  id,
  className,
  children,
}: {
  id: string
  className: string
  children: React.ReactNode
}) => {
  const { setNodeRef } = useDroppable({ id })
  return (
    <div ref={setNodeRef} className={className}>
      {children}
    </div>
  )
}

const SortableScriptItem = ({
  item,
  listId,
  opPushValue,
  onOpPushChange,
}: {
  item: ItemType
  listId: string
  opPushValue?: string
  onOpPushChange: (
    id: string,
    value: string,
    event: React.ChangeEvent<HTMLInputElement>
  ) => void
}) => {
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({
    id: item.id,
    data: { type: 'script', item, listId } as DragItemData,
  })

  // Translate only: the sortable transform includes a scale component that
  // distorts items of different widths. The dragged item itself is hidden in
  // place (the DragOverlay renders the moving copy) so it never drags the
  // scroll container into overflow.
  const style = {
    transform: isDragging ? undefined : CSS.Translate.toString(transform),
    transition,
  }

  return (
    <div
      id={item.id}
      ref={setNodeRef}
      style={style}
      className={clsx(
        'relative mr-[5px] flex h-[25px] select-none items-center rounded-sm bg-black/30 text-[13px] font-normal text-white',
        {
          'opacity-0': isDragging,
        }
      )}
      {...attributes}
      {...listeners}
    >
      <span
        className={clsx('flex items-center whitespace-nowrap', {
          'px-1.5': item.content !== 'OP_PUSH',
          'pl-1.5': item.content === 'OP_PUSH',
        })}
      >
        {item.content}
        {item.content === 'OP_PUSH' && (
          <input
            key={item.id}
            id={item.id}
            className="ml-2 mr-1 h-5 w-auto grow bg-white/20 px-1 text-white placeholder:text-white/50"
            placeholder="PUSH_DATA"
            type="text"
            value={opPushValue || ''}
            onPointerDown={(event) => event.stopPropagation()}
            onChange={(event) =>
              onOpPushChange(item.id, event.target.value, event)
            }
          />
        )}
      </span>
    </div>
  )
}

const DraggableToolboxItem = ({
  item,
  onClick,
}: {
  item: ItemType
  onClick: (item: ItemType) => void
}) => {
  const { attributes, listeners, setNodeRef, isDragging } = useDraggable({
    id: `${TOOLBOX_ID_PREFIX}${item.id}`,
    data: { type: 'toolbox', item } as DragItemData,
  })

  // The toolbox item stays in place while dragging; the DragOverlay renders
  // the copy that follows the pointer, so the scrollable toolbox never
  // overflows mid-drag.
  return (
    <div
      id={item.id}
      ref={setNodeRef}
      className={clsx(
        'relative mr-[5px] flex h-[25px] select-none items-center rounded-sm bg-black/30 text-[13px] font-normal text-white',
        {
          'opacity-60': isDragging,
        }
      )}
      onClick={() => onClick(item)}
      {...attributes}
      {...listeners}
    >
      <span
        className={clsx('flex items-center', {
          'px-1.5': item.content !== 'OP_PUSH',
          'pl-1.5': item.content === 'OP_PUSH',
        })}
      >
        {item.content === 'OP_PUSH' && (
          <input
            key={item.id}
            id={item.id}
            className={clsx(
              'pointer-events-none ml-2 mr-1 w-auto cursor-text rounded-sm bg-white/20 px-1 text-left placeholder:text-white/50'
            )}
            type="text"
            placeholder="PUSH_DATA"
          />
        )}
        {item.content}
      </span>
    </div>
  )
}

interface ScratchDndProps {
  items?: string[]
  prePopulate?: boolean
  onItemsUpdate?: (items: string[]) => void
  onEnableOpcodes: (enabledOpcodes: boolean) => void
}

interface ScratchDndState {
  dynamicState: StateType
  enabledOpcodes: boolean
  opPushValues: { [key: string]: string }
  groupedItems: Group[]
  activeDrag: DragItemData | null
}

export default class ScratchDnd extends Component<
  ScratchDndProps,
  ScratchDndState
> {
  constructor(props: ScratchDndProps) {
    super(props)

    let enabledOpcodes: boolean = false
    let opPushValues: { [key: string]: string } = {}

    const initialStateItems: ItemType[] = []
    if (props.prePopulate && props.items) {
      for (let i = 0; i < props.items.length; i++) {
        const item = props.items[i]
        const id = uuid()

        if (item === 'OP_PUSH' && props.items[i + 1]) {
          // Add the following item to opPushValues and skip it in the state
          opPushValues[id] = props.items[i + 1].toUpperCase()
          i++ // Skip the next item
        }

        initialStateItems.push({
          id,
          index: initialStateItems.length,
          content: item,
          category: '', // Adjust the category if needed
        })
      }
    }

    let filteredOpcodes = enabledOpcodes
      ? ITEMS
      : ITEMS.filter((opcode) => !experimentalOpCodes.includes(opcode.content))

    let groupedItems: Group[] = filteredOpcodes.reduce(
      (groups: Group[], item: ItemType) => {
        const group = groups.find((g) => g.heading === item.category)
        if (group) {
          group.items.push(item)
        } else {
          groups.push({
            heading: item.category,
            items: [item],
          })
        }
        return groups
      },
      []
    )

    this.state = {
      dynamicState: {
        [uuid()]: initialStateItems,
      },
      groupedItems,
      enabledOpcodes,
      opPushValues,
      activeDrag: null,
    }
  }

  // A small activation distance keeps plain clicks on toolbox items working
  // as click-to-add instead of being swallowed as zero-distance drags.
  sensors = [
    {
      sensor: PointerSensor,
      options: { activationConstraint: { distance: 5 } },
    },
  ]

  handleOpPushChange = (
    id: string,
    value: string,
    event: React.ChangeEvent<HTMLInputElement>
  ) => {
    const input = event?.target
    const caretPosition = input?.selectionStart

    this.setState(
      (prevState) => ({
        opPushValues: {
          ...prevState.opPushValues,
          [id]: value.toUpperCase(),
        },
      }),
      () => {
        input.setSelectionRange(caretPosition, caretPosition)
      }
    )
  }

  handleEnableExperimental = () => {
    this.setState((prevState) => {
      const newEnabledOpcodes = !prevState.enabledOpcodes

      let filteredItems = newEnabledOpcodes
        ? ITEMS
        : ITEMS.filter((item) => !experimentalOpCodes.includes(item.content))

      let updatedGroupedItems: Group[] = filteredItems.reduce(
        (groups: Group[], item: ItemType) => {
          const group = groups.find((g) => g.heading === item.category)
          if (group) {
            group.items.push(item)
          } else {
            groups.push({ heading: item.category, items: [item] })
          }
          return groups
        },
        []
      )

      return {
        enabledOpcodes: newEnabledOpcodes,
        groupedItems: updatedGroupedItems,
      }
    })
  }

  handlePasteFromClipboard = async () => {
    try {
      const text = await navigator.clipboard.readText()

      const hexRegex = /^(0x)?[0-9a-fA-F]+$/
      const newItems =
        (hexRegex.test(text) && hexToScript(text)) || text.split(' ')
      const newOpPushValues: { [key: string]: string } = {}
      const updatedItems: ItemType[] = []

      //if no items are opcodes break as the top item of the clipboard is wrong
      if (
        newItems.filter((value) => Object.keys(OpCodeTypes).includes(value))
          .length === 0
      ) {
        throw new Error('clipboard does not contain opcodes')
      }

      for (let i = 0; i < newItems.length; i++) {
        const item = newItems[i]
        const id = uuid()

        if (item === 'OP_PUSH' && newItems[i + 1]) {
          newOpPushValues[id] = newItems[i + 1].toUpperCase()
          i++
        }

        updatedItems.push({
          id,
          index: updatedItems.length,
          content: item,
          category: OpCodeTypes[item],
        })
      }

      const listId = Object.keys(this.state.dynamicState)[0] || uuid()

      this.setState((prevState) => ({
        dynamicState: {
          ...prevState.dynamicState,
          [listId]: [...prevState.dynamicState[listId], ...updatedItems],
        },
        opPushValues: {
          ...prevState.opPushValues,
          ...newOpPushValues,
        },
      }))
    } catch (error) {
      console.error('Failed to read clipboard:', error)
    }
  }

  handleItemClick = (item: ItemType) => {
    const newItem = { ...item, id: uuid() }
    const listId = Object.keys(this.state.dynamicState)[0]

    this.setState((prevState) => ({
      dynamicState: {
        ...prevState.dynamicState,
        [listId]: [...prevState.dynamicState[listId], newItem],
      },
    }))
  }

  getListIdByItemId = (state: ScratchDndState, itemId: string) => {
    return (
      Object.keys(state.dynamicState).find((listId) =>
        state.dynamicState[listId].some((item) => item.id === itemId)
      ) || null
    )
  }

  getOverListId = (state: ScratchDndState, overId: string | null) => {
    if (!overId) return null
    if (overId.startsWith(LIST_ID_PREFIX)) {
      return overId.slice(LIST_ID_PREFIX.length)
    }
    return this.getListIdByItemId(state, overId)
  }

  getItemIndex = (state: ScratchDndState, listId: string, itemId: string) => {
    return state.dynamicState[listId].findIndex((item) => item.id === itemId)
  }

  getInsertIndex = (
    state: ScratchDndState,
    listId: string,
    overId: string | null
  ) => {
    if (!overId || overId.startsWith(LIST_ID_PREFIX)) {
      return state.dynamicState[listId].length
    }
    const index = this.getItemIndex(state, listId, overId)
    return index === -1 ? state.dynamicState[listId].length : index
  }

  handleDragStart = (event: DragStartEvent) => {
    const activeData = event.active.data.current as DragItemData | undefined
    this.setState({ activeDrag: activeData ?? null })
  }

  handleDragCancel = () => {
    this.setState({ activeDrag: null })
  }

  handleDragEnd = (event: DragEndEvent) => {
    const { active, over } = event
    const activeData = active.data.current as DragItemData | undefined
    this.setState({ activeDrag: null })
    if (!activeData) return

    const overId = over?.id ? String(over.id) : null

    this.setState((prevState) => {
      const overListId = this.getOverListId(prevState, overId)
      const activeListId =
        activeData.listId ||
        this.getListIdByItemId(prevState, activeData.item.id)

      if (!overListId) {
        if (activeData.type === 'script' && activeListId) {
          const updatedList = prevState.dynamicState[activeListId].filter(
            (item) => item.id !== activeData.item.id
          )
          const updatedOpPushValues = { ...prevState.opPushValues }
          delete updatedOpPushValues[activeData.item.id]

          return {
            dynamicState: {
              ...prevState.dynamicState,
              [activeListId]: updatedList,
            },
            opPushValues: updatedOpPushValues,
          }
        }
        return null
      }

      if (activeData.type === 'toolbox') {
        const insertIndex = this.getInsertIndex(prevState, overListId, overId)
        const updatedList = [...prevState.dynamicState[overListId]]
        updatedList.splice(insertIndex, 0, { ...activeData.item, id: uuid() })

        return {
          dynamicState: {
            ...prevState.dynamicState,
            [overListId]: updatedList,
          },
          opPushValues: prevState.opPushValues,
        }
      }

      if (!activeListId) {
        return null
      }

      if (activeListId === overListId) {
        const activeIndex = this.getItemIndex(
          prevState,
          activeListId,
          activeData.item.id
        )
        const overIndex = this.getItemIndex(prevState, overListId, overId || '')
        if (activeIndex === -1 || overIndex === -1) {
          return null
        }
        if (activeIndex === overIndex) {
          return null
        }

        return {
          dynamicState: {
            ...prevState.dynamicState,
            [activeListId]: arrayMove(
              prevState.dynamicState[activeListId],
              activeIndex,
              overIndex
            ),
          },
          opPushValues: prevState.opPushValues,
        }
      }

      const sourceItems = [...prevState.dynamicState[activeListId]]
      const destinationItems = [...prevState.dynamicState[overListId]]
      const sourceIndex = this.getItemIndex(
        prevState,
        activeListId,
        activeData.item.id
      )
      if (sourceIndex === -1) {
        return null
      }
      const [movedItem] = sourceItems.splice(sourceIndex, 1)
      const insertIndex = this.getInsertIndex(prevState, overListId, overId)
      destinationItems.splice(insertIndex, 0, movedItem)

      return {
        dynamicState: {
          ...prevState.dynamicState,
          [activeListId]: sourceItems,
          [overListId]: destinationItems,
        },
        opPushValues: prevState.opPushValues,
      }
    })
  }

  componentDidUpdate(prevProps: ScratchDndProps) {
    // Check if the incoming items or prePopulate props have changed
    if (
      prevProps.items !== this.props.items ||
      prevProps.prePopulate !== this.props.prePopulate
    ) {
      // Reset the state with the new items
      const newItems = this.props.items || []
      const newOpPushValues: { [key: string]: string } = {}
      const newInitialStateItems: ItemType[] = []

      for (let i = 0; i < newItems.length; i++) {
        const item = newItems[i]
        const id = uuid()

        if (item === 'OP_PUSH' && newItems[i + 1]) {
          newOpPushValues[id] = newItems[i + 1].toUpperCase()
          i++ // Skip the next item
        }

        newInitialStateItems.push({
          id,
          index: newInitialStateItems.length,
          content: item,
          category: '', // Adjust the category if needed
        })
      }

      // Update state with the new items and opPushValues
      this.setState({
        dynamicState: {
          [uuid()]: newInitialStateItems,
        },
        opPushValues: newOpPushValues,
      })
    }

    // Existing logic for handling updates to dynamicState and opPushValues
    const updatedItems = Object.values(this.state.dynamicState).flatMap((arr) =>
      arr.map((item) => item)
    )

    const processedItems = updatedItems.flatMap((item) => {
      if (item.content === 'OP_PUSH') {
        const pushValueContent = this.state.opPushValues[item.id] || ''
        return [item.content, pushValueContent]
      } else {
        return [item.content]
      }
    })

    if (this.props.onItemsUpdate) {
      this.props.onItemsUpdate(processedItems)
      this.props.onEnableOpcodes(this.state.enabledOpcodes)
    }
  }

  render() {
    return (
      <DndContext
        sensors={this.sensors}
        collisionDetection={closestCenter}
        onDragStart={this.handleDragStart}
        onDragEnd={this.handleDragEnd}
        onDragCancel={this.handleDragCancel}
      >
        {Object.keys(this.state.dynamicState).map((listId) => {
          const listItems = this.state.dynamicState[listId]
          return (
            <div
              key={listId}
              className="border-b border-white/25 px-5 pt-[15px]"
            >
              <p className="font-space-mono text-[15px] font-bold">
                Your script
              </p>
              <ScriptDropZone
                id={getListDroppableId(listId)}
                className={clsx(
                  'flex h-[40px] w-full flex-row whitespace-nowrap font-space-mono',
                  {
                    'overflow-hidden': listItems.length === 0,
                    'overflow-x-auto overflow-y-hidden': listItems.length > 0,
                  }
                )}
              >
                <SortableContext
                  items={listItems.map((item) => item.id)}
                  strategy={horizontalListSortingStrategy}
                >
                  {listItems.length ? (
                    listItems.map((item) => (
                      <SortableScriptItem
                        key={item.id}
                        item={item}
                        listId={listId}
                        opPushValue={this.state.opPushValues[item.id]}
                        onOpPushChange={this.handleOpPushChange}
                      />
                    ))
                  ) : (
                    <div className="relative flex h-[40px] min-w-full select-none content-center items-start justify-start overflow-hidden text-[15px] text-white/50">
                      Drag OP_CODES here to build your script...
                    </div>
                  )}
                </SortableContext>
              </ScriptDropZone>
            </div>
          )
        })}
        <div
          className="flex h-full flex-col gap-y-2.5 overflow-y-auto bg-black/10 px-5 py-[15px]"
          dir="rtl"
        >
          {this.state.groupedItems.map((group, groupIndex) => (
            <div
              key={groupIndex}
              className="flex flex-row-reverse font-space-mono"
            >
              <h2 className="w-fit min-w-[100px] select-none text-left text-[13px] font-semibold">
                {group.heading}
              </h2>
              <div className="flex w-full flex-row-reverse flex-wrap gap-y-2.5 overflow-x-auto pl-1">
                {group.items.map((item) => (
                  <DraggableToolboxItem
                    key={item.id}
                    item={item}
                    onClick={this.handleItemClick}
                  />
                ))}
              </div>
            </div>
          ))}
        </div>
        <div className="flex justify-end bg-black/10">
          <button
            className="false m-2 inline-block max-w-[max-content] justify-center rounded-[3px] bg-white px-12 px-2.5 py-1 text-center font-nunito text-base font-bold  text-back transition duration-150 ease-in-out hover:bg-white/75"
            onClick={() => this.handleEnableExperimental()}
          >
            {this.state.enabledOpcodes
              ? 'Disable Experimental Opcodes'
              : 'Enable Experimental Opcodes'}
          </button>

          <button
            className="false m-2 inline-block max-w-[max-content] justify-center rounded-[3px] bg-white px-12 px-2.5 py-1 text-center font-nunito text-base font-bold  text-back transition duration-150 ease-in-out hover:bg-white/75"
            onClick={() => this.handlePasteFromClipboard()}
          >
            Paste From Clipboard
          </button>
        </div>
        {typeof document !== 'undefined' &&
          createPortal(
            <DragOverlay>
              {this.state.activeDrag && (
                <div className="flex h-[25px] cursor-grabbing select-none items-center rounded-sm bg-black/30 font-space-mono text-[13px] font-normal text-white">
                  <span
                    className={clsx('flex items-center whitespace-nowrap', {
                      'px-1.5':
                        this.state.activeDrag.item.content !== 'OP_PUSH',
                      'pl-1.5':
                        this.state.activeDrag.item.content === 'OP_PUSH',
                    })}
                  >
                    {this.state.activeDrag.item.content}
                    {this.state.activeDrag.item.content === 'OP_PUSH' && (
                      <span
                        className={clsx(
                          'ml-2 mr-1 flex h-5 items-center rounded-sm bg-white/20 px-1',
                          this.state.opPushValues[this.state.activeDrag.item.id]
                            ? 'text-white'
                            : 'text-white/50'
                        )}
                      >
                        {this.state.opPushValues[
                          this.state.activeDrag.item.id
                        ] || 'PUSH_DATA'}
                      </span>
                    )}
                  </span>
                </div>
              )}
            </DragOverlay>,
            document.body
          )}
      </DndContext>
    )
  }
}
