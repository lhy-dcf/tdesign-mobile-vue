import { computed, defineComponent, ref, toRefs, watch } from 'vue';
import { SideBar as TSideBar, SideBarItem as TSideBarItem } from '../side-bar';
import TRadio, { RadioGroup as TRadioGroup } from '../radio';
import TCheckbox, { CheckboxGroup as TCheckboxGroup } from '../checkbox';
import { convertUnit } from '../shared';
import log from '../_common/js/log';
import props from './props';
import { TdTreeSelectProps, TreeSelectValue } from './type';
import type { TreeOptionData } from '../common';
import { usePrefixClass } from '../hooks/useClass';
import useVModel from '../hooks/useVModel';

type OptionValue = string | number;
type SelectValue = OptionValue | OptionValue[];
type SelectValueGroup = Array<SelectValue | undefined>;

interface ColumnOption {
  label: TreeOptionData['label'];
  value: OptionValue;
  disabled: boolean;
  children?: TreeOptionData['children'];
}

const isDef = (value: unknown): boolean => value !== undefined && value !== null;

const toGroup = (value?: TreeSelectValue): SelectValueGroup =>
  Array.isArray(value) ? (value as SelectValueGroup) : [];

const getTreeDepth = (tree: TreeOptionData[], childrenKey: string): number =>
  (tree || []).reduce((max, node) => {
    const children = (node as Record<string, unknown>)[childrenKey];
    if (Array.isArray(children) && children.length > 0) {
      return Math.max(max, getTreeDepth(children as TreeOptionData[], childrenKey) + 1);
    }
    return Math.max(max, 1);
  }, 0);

export default defineComponent({
  name: 'TTreeSelect',
  components: {
    TSideBar,
    TSideBarItem,
    TRadio,
    TRadioGroup,
  },
  props,
  emits: ['update:value', 'update:modelValue', 'change'],
  setup(props: TdTreeSelectProps) {
    const treeSelectClass = usePrefixClass('tree-select');
    const { height, customStyle, value, modelValue, options, keys, multiple, customValue } = toRefs(props);
    const [innerValue, setInnerValue] = useVModel(value, modelValue, props.defaultValue, props.onChange);

    const leafLevel = ref(0);
    const treeOptions = ref<ColumnOption[][]>([]);
    const innerDisplayValue = ref<SelectValueGroup>([]);
    const rootStyle = computed(() => [`height: ${convertUnit(height.value)}`, customStyle.value].join(';'));

    // nav 逐层导航决定每列展开的分支；fill 为 true 时缺省级补齐默认选中第 0 项并级联父级；
    // display 显式指定展示选中值（customValue 接管时使用，优先级最高）。
    const buildTreeOptions = (nav: SelectValueGroup, config: { fill: boolean; display?: SelectValueGroup }) => {
      const source = options.value as TreeOptionData[];
      if (!source?.length) {
        treeOptions.value = [];
        innerDisplayValue.value = [];
        leafLevel.value = 0;
        return;
      }

      const labelKey = keys.value?.label || 'label';
      const valueKey = keys.value?.value || 'value';
      const disabledKey = keys.value?.disabled || 'disabled';
      const childrenKey = keys.value?.children || 'children';
      const isMultiple = multiple.value;

      let level = -1;
      const columns: ColumnOption[][] = [];
      let node: { children?: TreeOptionData['children'] } | ColumnOption = { children: source };

      while (node && node.children) {
        level += 1;
        const children = Array.isArray(node.children) ? node.children : [];
        const list: ColumnOption[] = children.map((item) => {
          const record = item as Record<string, unknown>;
          return {
            label: record[labelKey] as ColumnOption['label'],
            value: record[valueKey] as OptionValue,
            disabled: Boolean(record[disabledKey]),
            children: record[childrenKey] as TreeOptionData['children'],
          };
        });
        columns.push(list);

        const currentValue = nav[level];
        node = list.find((child) => isDef(currentValue) && child.value === currentValue) ?? list[0];
      }

      const depth = getTreeDepth(source, childrenKey);
      while (columns.length < depth) {
        columns.push([]);
        level += 1;
      }

      leafLevel.value = Math.max(0, level);
      treeOptions.value = columns;

      if (config.display) {
        innerDisplayValue.value = [...config.display];
      } else if (config.fill) {
        innerDisplayValue.value = columns.map((col, idx) => {
          const isLeaf = idx === columns.length - 1;
          const first = col[0]?.value;
          let fallback: SelectValue | undefined = first;
          if (isLeaf && isMultiple) {
            fallback = first == null ? [] : [first];
          }
          return nav[idx] ?? fallback;
        });
      } else {
        innerDisplayValue.value = [...nav];
      }

      if (isMultiple) {
        const leaf = innerDisplayValue.value[leafLevel.value];
        if (leaf != null && !Array.isArray(leaf)) {
          log.error('TreeSelect', `\`value\` should be an array when \`multiple\` is true, got \`${typeof leaf}\``);
        }
      }
    };

    // 逐层合并，customValue 优先、value 兜底（对齐小程序 customValue?.[level] ?? value?.[level]）
    const mergeNav = (custom: SelectValueGroup, base: SelectValueGroup): SelectValueGroup => {
      const len = Math.max(custom.length, base.length);
      return Array.from({ length: len }, (_, i) => custom[i] ?? base[i]);
    };

    // 仅 customValue 自身变化时才重新接管选中值；交互只改动 value，不被 customValue 覆盖。
    let customSnapshot: string | undefined;

    const rebuild = () => {
      const inCustomMode = customValue.value != null;
      const snapshot = JSON.stringify(customValue.value ?? null);
      const base = toGroup(innerValue.value);

      if (snapshot !== customSnapshot) {
        customSnapshot = snapshot;
        if (inCustomMode) {
          const custom = toGroup(customValue.value);
          buildTreeOptions(mergeNav(custom, base), { fill: false, display: custom });
          return;
        }
      }
      buildTreeOptions(base, { fill: !inCustomMode });
    };

    const updateValue = (level: number) => {
      buildTreeOptions([...innerDisplayValue.value], { fill: customValue.value == null });
      setInnerValue([...innerDisplayValue.value] as TreeSelectValue, level);
    };

    const handleTreeClick = (itemValue: OptionValue, level: number, disabled: boolean) => {
      if (disabled) return;
      const next = [...innerDisplayValue.value];
      next[level] = itemValue;
      buildTreeOptions(next, { fill: customValue.value == null });
      setInnerValue([...innerDisplayValue.value] as TreeSelectValue, level);
    };

    watch([innerValue, options, keys, multiple, customValue], rebuild, { immediate: true, deep: true });

    const getTreeClass = (level: number, total: number) => {
      if (level === 0) return 'right';
      if (level === 1 && level !== total - 1) return 'middle';
      return 'left';
    };

    const renderSideBar = (column: ColumnOption[]) => (
      <TSideBar
        v-model={innerDisplayValue.value[0]}
        class={`${treeSelectClass.value}-colum`}
        onChange={() => updateValue(0)}
      >
        {column.map((item, index) => (
          <TSideBarItem key={index} label={item.label as string} value={item.value} disabled={item.disabled} />
        ))}
      </TSideBar>
    );

    const renderMiddleLevel = (column: ColumnOption[], level: number) =>
      column.map((item) => (
        <div
          key={item.value}
          class={{
            [`${treeSelectClass.value}__item`]: true,
            [`${treeSelectClass.value}__item--active`]: item.value === innerDisplayValue.value[level],
            [`${treeSelectClass.value}__item--disabled`]: item.disabled,
          }}
          onClick={() => handleTreeClick(item.value, level, item.disabled)}
        >
          {item.label}
        </div>
      ));

    const renderLeafLevel = (column: ColumnOption[], level: number) => {
      if (multiple.value) {
        return (
          <TCheckboxGroup
            v-model={innerDisplayValue.value[level]}
            class={`${treeSelectClass.value}__checkbox`}
            onChange={() => updateValue(level)}
          >
            {column.map((item) => (
              <TCheckbox
                key={item.value}
                class={`${treeSelectClass.value}__checkbox-item`}
                value={item.value}
                maxLabelRow={1}
                icon="line"
                borderless
                placement="right"
                disabled={item.disabled}
              >
                {item.label}
              </TCheckbox>
            ))}
          </TCheckboxGroup>
        );
      }
      return (
        <TRadioGroup
          v-model={innerDisplayValue.value[level]}
          class={`${treeSelectClass.value}__radio`}
          onChange={() => updateValue(level)}
        >
          {column.map((item) => (
            <TRadio
              key={item.value}
              class={`${treeSelectClass.value}__radio-item`}
              value={item.value}
              icon="line"
              maxLabelRow={1}
              borderless
              placement="right"
              disabled={item.disabled}
            >
              {item.label}
            </TRadio>
          ))}
        </TRadioGroup>
      );
    };

    return () => (
      <div class={treeSelectClass.value} style={rootStyle.value}>
        {treeOptions.value.map((column, level) => {
          let content;
          if (level === 0) {
            content = renderSideBar(column);
          } else if (level === leafLevel.value) {
            content = renderLeafLevel(column, level);
          } else {
            content = renderMiddleLevel(column, level);
          }

          return (
            <div
              key={level}
              class={[
                `${treeSelectClass.value}__column`,
                `${treeSelectClass.value}__column--${getTreeClass(leafLevel.value - level, treeOptions.value.length)}`,
              ]}
            >
              {content}
            </div>
          );
        })}
      </div>
    );
  },
});
