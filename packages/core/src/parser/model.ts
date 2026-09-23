import type {
  ERDataModelVersion,
  ERDataModel,
  ERDataContainerDescriptor,
  ERDataContainerItem,
} from '../types/model.js';
import { getAttr, getContentsArray } from './xml-document.js';
import type { XmlNode } from './xml-document.js';
import { selectVersionNode } from './envelope.js';

// ─── Data Model ───

export function parseDataModelVersion(root: XmlNode): ERDataModelVersion {
  const vNode = selectVersionNode(root, 'ERDataModelVersion');
  if (!vNode) throw new Error('Missing ERDataModelVersion element');

  const idAttr = getAttr(vNode, 'ID.') ?? '';
  const id = idAttr.split(',')[0];

  const modelNode = vNode['Model']?.['ERDataModel'];

  return {
    id,
    dateTime: getAttr(vNode, 'DateTime') ?? '',
    description: getAttr(vNode, 'Description') ?? '',
    number: parseInt(getAttr(vNode, 'Number') ?? '0', 10),
    model: parseDataModel(modelNode),
  };
}

function parseDataModel(node: XmlNode | undefined): ERDataModel {
  if (!node) throw new Error('Missing ERDataModel element');

  const containers = getContentsArray(node, 'ERDataContainerDescriptor').map(parseContainer);

  return {
    id: getAttr(node, 'ID.') ?? '',
    name: getAttr(node, 'Name') ?? '',
    containers,
  };
}

function parseContainer(node: XmlNode): ERDataContainerDescriptor {
  const items = getContentsArray(node, 'ERDataContainerDescriptorItem').map(
    (item: any): ERDataContainerItem => ({
      name: getAttr(item, 'Name') ?? '',
      type: parseInt(getAttr(item, 'Type') ?? '6', 10),
      typeDescriptor: getAttr(item, 'TypeDescriptor'),
      isTypeDescriptorHost: getAttr(item, 'IsTypeDescriptorHost') === '1',
      label: getAttr(item, 'Label'),
      description: getAttr(item, 'Description'),
    }),
  );

  return {
    id: getAttr(node, 'ID.') ?? '',
    name: getAttr(node, 'Name') ?? '',
    label: getAttr(node, 'Label'),
    description: getAttr(node, 'Description'),
    isRoot: getAttr(node, 'IsRoot') === '1',
    isEnum: getAttr(node, 'IsEnum') === '1',
    items,
  };
}
